const Cc = Components.classes;
const Ci = Components.interfaces;

Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");

var gOS;
const Query = {
    getPrice: "select price from simple_prices where typeID=:tid " +
            "and date('now') < date(exp_date);",
    setPrice: "replace into simple_prices values(:tid, :price, " +
            "date('now', '+7 days'));",
};
const Stm = {};
function evecentral() {
    gOS = Cc["@mozilla.org/observer-service;1"].getService(Ci.nsIObserverService);
}

evecentral.prototype = {
    classDescription:   "EVE Central price provider",
    classID:            Components.ID("{c618fc80-7515-4f84-bd85-3d351978a4dc}"),
    contractID:         "@aragaer/eve/market-data/provider;1?name=eve-central",
    QueryInterface:     XPCOMUtils.generateQI([Ci.nsIEveMarketDataProviderService,
            Ci.nsIObserver]),
    _xpcom_categories:  [{
        category: "app-startup",
        service: true
    }],

    get name()          "EVE Central",

    getPriceForItemAsync:   function (typeID, params, handler) {
        var price = getPriceFromDB(typeID);
        if (price != -1) {
            handler.onData(price);
            return true;
        }
        var data = prepareData(typeID, params);
        var req = makeReq();
        req.open('POST', 'http://api.eve-central.com/api/marketstat', true);
        req.setRequestHeader('Content-Type','application/x-www-form-urlencoded');
        req.onreadystatechange = function (aEvt) {
            if (req.readyState == 4)
                handler.onData(processResult(req, params, typeID));
        };
        req.send(data);
        return true;
    },
    getPriceForItem:    function (typeID, params) {
        var price = getPriceFromDB(typeID);
        if (price != -1) {
            handler.onData(price);
            return true;
        }
        var data = prepareData(typeID, params);
        var req = makeReq();
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
    observe:        function (aSubject, aTopic, aData) {
        dump('Got '+aTopic+' event in eve central\n');
        switch (aTopic) {
        case 'app-startup':
            gOS.addObserver(this, 'eve-db-init', false);
            break;
        case 'eve-db-init':
            var db = Cc["@aragaer/eve/db;1"].getService(Ci.nsIEveDBService);
            dump("DB service is initialized in eve-central... store connection now\n");
            this._conn = db.getConnection();
            if (!this._conn.tableExists('simple_prices'))
                this._conn.createTable('simple_prices',
                        'typeID integer, price float, exp_date char, primary key (typeID)');
            for (i in Query)
                try {
                    Stm[i] = this._conn.createStatement(Query[i]);
                } catch (e) {
                    dump(this._conn.lastErrorString+"\n");
                }
            break;
        }
    },
};

var components = [evecentral];
function NSGetModule(compMgr, fileSpec) {
    return XPCOMUtils.generateModule(components);
}
function makeReq()
    Cc["@mozilla.org/xmlextras/xmlhttprequest;1"].createInstance(Ci.nsIXMLHttpRequest);

function getPriceFromDB(typeID) {
    let stm = Stm.getPrice;
    stm.params.tid = typeID;
    try {
        stm.execute();
        if (stm.step())
            return stm.row.price;
    } catch (e) {
        dump(""+e+"\n");
    } finally {
        stm.reset();
    }
    return -1;
}

function writePriceToDB(typeID, price) {
    let stm = Stm.setPrice;
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
function processResult(req, params, typeID) {
    var field = params.req || "//all/median";
    if (req.status != 200) {
        dump('Failed to connect to server!\n');
        gOS.notifyObservers(null, 'eve-market-error', 'Failed to connect to server '+req.status);
    }

    var xpe = Cc["@mozilla.org/dom/xpath-evaluator;1"].
            createInstance(Ci.nsIDOMXPathEvaluator);
    var nsResolver = xpe.createNSResolver(req.responseXML.documentElement);
    var result;
    try {
        result = xpe.evaluate(field+"/text()", req.responseXML, nsResolver, 0, null);
    } catch (e) {
        dump("error running xpe with expression '"+field+"/text()'\n");
        return 0;
    }

    var res = result.iterateNext();
    if (res) {
        writePriceToDB(typeID, res.data)
        return res.data;
    } else
        return 0;
}

function prepareData(typeID, params) {
    var data = ['typeid='+typeID].concat([i+'='+params[i] for (i in ['hours', 'minQ']) if (params[i])]);
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
