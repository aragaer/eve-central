const Cc = Components.classes;
const Ci = Components.interfaces;

Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");

function evecentral() { }

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
    getPriceForItem:    function (typeID, params) {
        var data = ['typeid='+typeID];
        if (params) {
            data.push([i+'='+params[i] for (i in ['hours', 'minQ']) if (params[i])]);
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
        } else
            params = {req: "//all/median"};
        data = data.join('&');
        var req = Cc["@mozilla.org/xmlextras/xmlhttprequest;1"].
                createInstance(Ci.nsIXMLHttpRequest);
        req.open('POST', 'http://api.eve-central.com/api/marketstat', false);
        req.setRequestHeader('Content-Type','application/x-www-form-urlencoded');
        try {
            var t = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
            t.initWithCallback(req.abort, 5000, t.TYPE_ONE_SHOT);
            req.send(data);
            t.cancel();
        } catch (e) {
            dump(e.toString()+"\n");
            req = {status: 0};
        }
        if (req.status != 200) {
            dump('Failed to connect to server!\n');
            gOS.notifyObservers(null, 'eve-market-error', 'Failed to connect to server '+req.status);
        }
 
        return evaluateXPath(req.responseXML, params.req+"/text()")[0].data;
    },
};

var components = [evecentral];
function NSGetModule(compMgr, fileSpec) {
    return XPCOMUtils.generateModule(components);
}

function evaluateXPath(aNode, aExpr) {
    var found = [];
    var res, result;
    var xpe = Cc["@mozilla.org/dom/xpath-evaluator;1"].
            createInstance(Ci.nsIDOMXPathEvaluator);
    var nsResolver = xpe.createNSResolver(aNode.ownerDocument == null
            ? aNode.documentElement
            : aNode.ownerDocument.documentElement);
    try {
        result = xpe.evaluate(aExpr, aNode, nsResolver, 0, null);
    } catch (e) {
        dump("error running xpe with expression '"+aExpr+"'\nCaller:"+
              evaluateXPath.caller+"\n");
        return found;
    }
    while (res = result.iterateNext())
        found.push(res);
    return found;
}

