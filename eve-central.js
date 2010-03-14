const Cc = Components.classes;
const Ci = Components.interfaces;

Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");

var gOS;
function evecentral() {
    gOS = Cc["@mozilla.org/observer-service;1"].getService(Ci.nsIObserverService);
}

evecentral.prototype = {
    classDescription:   "EVE Central price provider",
    classID:            Components.ID("{c618fc80-7515-4f84-bd85-3d351978a4dc}"),
    contractID:         "@aragaer/eve/market-data/provider;1?name=eve-central",
    QueryInterface:     XPCOMUtils.generateQI([Ci.nsIEveMarketDataProviderService]),
    _xpcom_categories:  [{
        category: "app-startup",
        service: true
    }],

    get name()          "EVE Central",
    _prepareData:       function (typeID, params) {
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
    },
    _processResult:     function (req, params) {
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
        return res ? res.data : 0;
    },
    _makeReq:           function ()
        Cc["@mozilla.org/xmlextras/xmlhttprequest;1"].createInstance(Ci.nsIXMLHttpRequest),

    getPriceForItemAsync:   function (typeID, params, handler) {
        var data = this._prepareData(typeID, params);
        var req = this._makeReq();
        var process = this._processResult;
        req.open('POST', 'http://api.eve-central.com/api/marketstat', true);
        req.setRequestHeader('Content-Type','application/x-www-form-urlencoded');
        req.onreadystatechange = function (aEvt) {
            if (req.readyState == 4)
                handler.onData(process(req, params));
        };
        req.send(data);
        return true;
    },
    getPriceForItem:    function (typeID, params) {
        var data = this._prepareData(typeID, params);
        var req = this._makeReq();
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
        return this._processResult(req, params);
    },
};

var components = [evecentral];
function NSGetModule(compMgr, fileSpec) {
    return XPCOMUtils.generateModule(components);
}

