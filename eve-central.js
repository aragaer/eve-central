const Cc = Components.classes;
const Ci = Components.interfaces;

Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");
Components.utils.import("resource://gre/modules/Services.jsm");

const Query = {
    getPriceSimple: "select price from simple_prices where typeID=:tid " +
            "and date('now') < date(exp_date);",
    getPrice: "select data from eve_central_prices where typeID=:tid " +
            "and hashstring=:hash and date('now') < date(exp_date);",
    setPriceSimple: "replace into simple_prices values(:tid, :price, " +
            "date('now', '+7 days'));",
    setPrice: "replace into eve_central_prices " +
            "(typeID, hashstring, data, exp_date) " +
            "values(:tid, :hash, :data, date('now', '+7 days'));",
};
const Stm = {};
var gEC;
function evecentral() {
    if (gEC)
        return;
    gEC = this;
    var db = Cc["@aragaer/eve/db;1"].getService(Ci.nsIEveDBService);
    try {
        if (gEC._conn = db.getConnection()) // assignment!
            init();
    } catch (e) {
        Services.obs.addObserver(this, 'eve-db-init', false);
    }
    Services.obs.addObserver(this, 'eve-market-init', false);
}

var _accepts = [
    {
        name:       "regionlimit",
        required:   false,
        several:    true,
        desc:       "List of regions to which the search should be limited",
        type:       "integer",
    },
    {
        name:       "usesystem",
        required:   false,
        several:    false,
        desc:       "Restrict statistics to a single system",
        type:       "integer",
    },
];

var _provides = [
    {
        name:       'sell/min',
        desc:       "The lowest of sell prices",
    },
    {
        name:       'buy/max',
        desc:       "The highest of buy prices",
    },
    {
        name:       'all/median',
        desc:       "Median price",
    },
];

evecentral.prototype = {
    classDescription:   "EVE Central price provider",
    classID:            Components.ID("{c618fc80-7515-4f84-bd85-3d351978a4dc}"),
    contractID:         "@aragaer/eve/market-data/provider;1?name=eve-central",
    QueryInterface:     XPCOMUtils.generateQI([Ci.nsIEveMarketDataProviderService,
            Ci.nsIObserver]),

    get name()          "EVE Central",
    get accepts()       {
        var arr = Cc["@mozilla.org/array;1"].createInstance(Ci.nsIMutableArray);
        [arr.appendElement({wrappedJSObject: el}, false) for each (el in _accepts)];
        return arr.QueryInterface(Ci.nsIArray);
    },
    get provides()      {
        var arr = Cc["@mozilla.org/array;1"].createInstance(Ci.nsIMutableArray);
        [arr.appendElement({wrappedJSObject: el}, false) for each (el in _provides)];
        return arr.QueryInterface(Ci.nsIArray);
    },

    getPriceForItemAsync:   function (typeID, params, handler) {
        var price = getPriceSimpleFromDB(typeID);
        if (price != -1) {
            handler.onData(price);
            return true;
        }
        var data = prepareData(typeID, params);
        var req = makeReq(true);
        req.onreadystatechange = function (aEvt) {
            if (req.readyState == 4)
                handler.onData(processResult(req, params, typeID));
        };
        req.send(data);
        return true;
    },
    getPriceForItemAsync2:  function (typeID, params, handler) {
        var data = prepareData(typeID, params);
        var hash = makeHash(data);
        var price_data = getPriceFromDB(typeID, hash);
        if (price_data)
            return handler.onData({wrappedJSObject: JSON.parse(price_data)});
        var req = makeReq(true);
        req.onreadystatechange = function (aEvt) {
            if (req.readyState == 4)
                handler.onData({wrappedJSObject: processResult2(req, typeID, hash)});
        };
        req.send(data);
    },
    getPriceForItem:    function (typeID, params) {
        var price = getPriceSimpleFromDB(typeID);
        if (price != -1)
            return price;
        var data = prepareData(typeID, params);
        var req = makeReq(false);
        req.open('POST', 'http://api.eve-central.com/api/marketstat', false);
        req.setRequestHeader('Content-Type','application/x-www-form-urlencoded');
        try {
            var t = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
            t.initWithCallback(req.abort, 5000, t.TYPE_ONE_SHOT);
            req.send(data);
            t.cancel();
        } catch (e) {
            dump("Requesting data from eve central: "+e+"\n");
            req = {status: 0};
        }
        return processResult(req, params, typeID);
    },
    getPriceForItem2:   function (typeID, params) {
        var data = prepareData(typeID, params);
        var hash = makeHash(data);
        var price_data = getPriceFromDB(typeID, hash);
        if (price_data)
            return {wrappedJSObject: JSON.parse(price_data)};
        var req = makeReq(false);
        try {
            var t = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
            t.initWithCallback(req.abort, 5000, t.TYPE_ONE_SHOT);
            req.send(data);
            t.cancel();
        } catch (e) {
            dump("Requesting data from eve central: "+e+"\n");
            req = {status: 0};
        }
        return {wrappedJSObject: processResult2(req, typeID, hash)};
    },
    observe:        function (aSubject, aTopic, aData) {
        dump('Got '+aTopic+' event in eve central\n');
        switch (aTopic) {
        case 'eve-db-init':
            gEC._conn = aSubject.QueryInterface(Ci.mozIStorageConnection);
            init();
            break;
        case 'eve-market-init':
            Services.obs.notifyObservers(null, 'eve-market-provider-init', 'eve-central');
            break;
        }
    },
};

var components = [evecentral];
if (XPCOMUtils.generateNSGetFactory)
    var NSGetFactory = XPCOMUtils.generateNSGetFactory(components);
else
    var NSGetModule = XPCOMUtils.generateNSGetModule(components);

function init() {
    if (!gEC._conn.tableExists('simple_prices'))
        gEC._conn.createTable('simple_prices',
                'typeID integer, price float, exp_date char, primary key (typeID)');
    if (!gEC._conn.tableExists('eve_central_prices'))
        gEC._conn.createTable('eve_central_prices',
                'typeID integer, exp_date char, hashstring char, data char, ' +
                'primary key (typeID, hashstring)');
    try {
        for (var i in Query)
            Stm[i] = gEC._conn.createStatement(Query[i]);
    } catch (e) {
        dump(gEC._conn.lastErrorString+"\n");
    }
    dump("Eve central init done\n");
}

function makeReq(async) {
    var req = Cc["@mozilla.org/xmlextras/xmlhttprequest;1"].createInstance(Ci.nsIXMLHttpRequest);

    req.open('POST', 'http://api.eve-central.com/api/marketstat', async);
    req.setRequestHeader('Content-Type','application/x-www-form-urlencoded');
    return req;
}
function getPriceSimpleFromDB(typeID) {
    let stm = Stm.getPriceSimple;
    stm.params.tid = typeID;
    try {
        if (stm.step())
            return stm.row.price;
    } catch (e) {
        dump(""+e+"\n");
    } finally {
        stm.reset();
    }
    return -1;
}

function getPriceFromDB(typeID, hash) {
    let stm = Stm.getPrice;
    stm.params.tid = typeID;
    stm.params.hash = hash;
    try {
        if (stm.step())
            return stm.row.data;
    } catch (e) {
        dump(""+e+"\n");
    } finally {
        stm.reset();
    }
    return null;
}

function writePriceToDB(typeID, price) {
    let stm = Stm.setPriceSimple;
    try {
        stm.params.tid = typeID;
        stm.params.price = price;
        stm.execute();
    } catch (e) {
        dump(""+e+"\n");
    } finally {
        stm.reset();
    }
}

function writePriceToDB2(typeID, data, hash) {
    let stm = Stm.setPrice;
    try {
        stm.params.tid = typeID;
        stm.params.data = data;
        stm.params.hash = hash;
        stm.execute();
    } catch (e) {
        dump(""+e+"\n");
    } finally {
        stm.reset();
    }
}

function processResult2(req, typeID, hash) {
    var res, xpe_res;
    var result = {buy: {}, sell: {}, all: {}};
    if (req.status != 200) {
        dump('Failed to connect to server!\n');
        Services.obs.notifyObservers(null, 'eve-market-error', 'Failed to connect to server '+req.status);
        return null;
    }

    var xpe = Cc["@mozilla.org/dom/xpath-evaluator;1"].
            createInstance(Ci.nsIDOMXPathEvaluator);
    var nsResolver = xpe.createNSResolver(req.responseXML.documentElement);
    try {
        xpe_res = xpe.evaluate('//min | //max | //median | //average', req.responseXML, nsResolver, 0, null);
    } catch (e) {
        dump("error running xpe: "+e+"\n");
        return null;
    }

    while (res = xpe_res.iterateNext())
        result[res.parentNode.tagName][res.tagName] = +res.textContent;

    writePriceToDB2(typeID, JSON.stringify(result), hash)
    return result;
}

function processResult(req, params, typeID) {
    var field = params.req || "//all/median";
    if (req.status != 200) {
        dump('Failed to connect to server!\n');
        Services.obs.notifyObservers(null, 'eve-market-error', 'Failed to connect to server '+req.status);
        return -1;
    }

    var xpe = Cc["@mozilla.org/dom/xpath-evaluator;1"].
            createInstance(Ci.nsIDOMXPathEvaluator);
    var nsResolver = xpe.createNSResolver(req.responseXML.documentElement);
    var result;
    try {
        result = xpe.evaluate(field+"/text()", req.responseXML, nsResolver, 0, null);
    } catch (e) {
        dump("error running xpe with expression '"+field+"/text()'\n");
        return -1;
    }

    var res = result.iterateNext();
    if (res) {
        writePriceToDB(typeID, res.data)
        return res.data;
    } else
        return -1;
    return result;
}

const stringparams = 'hours minQ usesystem'.split(' ');
function prepareData(typeID, params) {
    var data = ['typeid='+typeID].concat([i+'='+params[i] for (i in stringparams) if (params[i])]);
    switch (typeof params.regionlimit) {
    case 'string':
    case 'number':
        data.push('regionlimit='+params.regionlimit);
        break;
    case 'object':
        data.push(['regionlimit='+i for each (i in params.regionlimit)]);
        break;
    default:
        break;
    }
    return data.join('&');
}

function makeHash(str) {
    var converter = Cc["@mozilla.org/intl/scriptableunicodeconverter"].
            createInstance(Ci.nsIScriptableUnicodeConverter);
    converter.charset = "UTF-8";
    var result = {};
    // data is an array of bytes
    var data = converter.convertToByteArray(str, result);
    var hasher = Cc["@mozilla.org/security/hash;1"].createInstance(Ci.nsICryptoHash);
    hasher.init(hasher.MD5);
    hasher.update(data, data.length);
    var hash = hasher.finish(false);
    return [toHexString(hash.charCodeAt(i)) for (i in hash)].join("");
}

function toHexString(c) ("00" + c.toString(16)).slice(-2)
