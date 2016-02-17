importScript("../modevlib/charts/mgChart.js");
importScript("../modevlib/layouts/dynamic.js");
importScript("../modevlib/layouts/layout.js");
importScript("../modevlib/collections/aMatrix.js");


var _search;

(function(){

  var DEBUG=false;

  var MAX_TESTS_PER_PAGE = 50;
  var CHART_TEMPLATE = new Template(
    '<div style="padding-top:10px;">' +
    '<h3>{{platform}} {{suite}}</h3>' +
    '{{test}}'+
    '<div id="chart{{num}}" class="chart" style="height:300px;width:800px;"></div>' +
    '</div>');

  var HOVER = new Template(
    '<b>{{status|upper}}</b><br>' +
    '<b>Branch :</b>{{branch}}<br>' +
    '<b>Revision :</b>{{revision|left(12)}}<br>' +
    '<b>Duration :</b>{{duration|round(3)}} seconds'
  );

  var debugFilter = {"eq": {
    "build.platform": "linux",
    "build.type": "pgo",
    "run.suite": "mochitest-other"
  }};


  _search = function(testName, dateFilter){
    Thread.run(function*(){
      //WHAT DIMENSION ARE WE SHOWING?
      var a = Log.action("searching...", true);
      try {
        var partitions = yield (search({
          "from": "unittest",
          "groupby": [
            "run.chunk",
            "run.suite",
            "run.type",
            "result.test",
            "build.platform",
            "build.type"
          ],
          "where": {
            "and": [
              dateFilter,
              {"regex": {"result.test": ".*" + convert.String2RegExp(testName) + ".*"}},
              DEBUG ? debugFilter : true
            ]
          },
          "limit": 100,
          "format": "list"
        }));
      }finally{
        Log.actionDone(a);
      }//try

      var chartArea = $("#charts");
      if (partitions.data.length>MAX_TESTS_PER_PAGE){
        chartArea.html(partitions.data.length+" is too many combinations");
        yield (null);
      }//endif

      chartArea.html("");
      partitions.data.forall(function(combo, i){
        if (DEBUG && i>0) return;
        var platform = combo.build.platform + (combo.build.type ? (" (" + combo.build.type + ")") : "");
        var suite = combo.run.suite + (combo.run.chunk ? " (chunk "+run.chunk+")" : "") + (combo.run.type ? (" (" + combo.run.type + ")") : "");
        var test = combo.result.test;
        chartArea.append(CHART_TEMPLATE.expand({"num": i, "platform": platform, "suite": suite, "test": test}));
        combo.count = undefined;
        //PULL DATA AND SHOW CHART
        (function(i){
            showOne("chart" + i, Map.zip(Map.leafItems(combo)), dateFilter);
        })(i);
      });
    });
  };//function


  function showOne(target, group, dateFilter){
    Thread.run(function*(){

      var a = Log.action("find test results", true);
      try {
        //PULL FAILURE DETAILS
        var result = yield (search({
          "from": "unittest",
          "select": [
            "_id",
            {"name": "suite", "value": "run.suite"},
            {"name": "chunk", "value": "run.chunk"},
            {"name": "duration", "value": {"coalesce":["result.duration", -1]}},
            {"name": "test", "value": "result.test"},
            {"name": "platform", "value": "build.platform"},
            {"name": "build_type", "value": "build.type"},
            {"name": "build_date", "value": "build.date"},
            {"name": "branch", "value": "build.branch"},
            {"name": "revision", "value": "build.revision12"},
            {"name": "ok", "value": "result.ok"},
            {
              "name": "status",
              "value": {
                "case": [
                  {"when": {"missing": "duration"}, "then": {"literal": "incomplete"}},
                  {"when": "result.ok", "then": {"literal": "pass"}},
                  {"literal": "fail"}
                ]

              }
            }
          ],
          "where": {
            "and": [
              {"neq": {"build.branch": "try"}},
              dateFilter,
              {"eq": group}
            ]
          },
          "sort": "build.date",
          "limit": (DEBUG ? 100 : 100000),
          "format": "list"
        }));
      } catch (e) {
        Log.error("Problem collecting test results from ActiveData", e);
      } finally {
        Log.actionDone(a);
      }//try

      {//CHART LIB DEMANDS NO POINTS OVERLAP, ADD A SECOND TO EACH LANDING ON IDENTICAL build_date
        var last_build_date = 0;
        var offset = 0;
        result.data.forall(function(d, i, data){
          if (last_build_date == d.build_date) {
            offset++;
            d.build_date = last_build_date + offset;
          } else {
            last_build_date = d.build_date;
            offset = 0;
          }//endif
          d.build_date=Date.newInstance(d.build_date);
        });
      }

      a = Log.action("Make chart", true);
      try {
        aChart.showScatter({
          "target": target,
          "data": result.data,
          "tip":{
            "format": HOVER
          },
          "click": function(d){
            window.open(new Template('https://treeherder.mozilla.org/#/jobs?repo={{branch}}&revision={{revision}}').replace(d));
          },
          "series": [
            {
              "axis": "color",
              "value": "status"
            }
          ],
          "axis": {
            "x": {
              "format": "{{.|format('NNN dd, HH:mm')}}",
              "size": 50,
              "value": "build_date"
            },
            "y":{
              "value": "duration"
            },
            "color":{
              "domain": {
                "type": "set", "partitions": [
                  {"name": "pass", "value": "pass", "style": {"color": "#1f77b4"}},
                  {"name": "fail", "value": "fail", "style": {"color": "#ff7f0e"}},
                  {"name": "incomplete", "value": "incomplete", "style": {"color": "#d62728"}}
                ]
              }
            }
          }
        });
      } finally {
        Log.actionDone(a);
      }//try

      yield (null);
    });

  }//function


  var CACHE;
  (function(){
    var cache = {};

    function _CACHE(func){
      if (String(retval) === '[object Generator]') {

      } else {

      }//endif

      var output = function(){
        var key = convert.value2json(arguments);
        var result = cache[key];
        if (result === undefined) {
          result = func.apply(this, arguments);
          cache[key] = result;
        }//endif
        return result;
      };
      return output;
    }//function
    CACHE = _CACHE;
  })();

})();
