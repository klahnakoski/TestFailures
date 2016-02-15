importScript("../modevlib/charts/mgChart.js");
importScript("../modevlib/layouts/dynamic.js");
importScript("../modevlib/layouts/layout.js");
importScript("../modevlib/collections/aMatrix.js");


var _search;

(function(){
  var MAX_TESTS_PER_PAGE = 50;
  var CHART_TEMPLATE = new Template('<div><h3>{{name}}</h3><div id="chart{{num}}" class="chart"></div></div>');
  var DEBUG=true;

  _search = function(testName, dateFilter){
    Thread.run(function*(){
      //WHAT DIMENSION ARE WE SHOWING?
      var a = Log.action("searching...", true);
      try {
        var partitions = yield (search({
          "from": "unittest",
          "groupby": [
            {"name": "suite", "value": "run.suite"},
            {"name": "test", "value": "result.test"},
            {"name": "platform", "value": "build.platform"},
            {"name": "build_type", "value": "build.type"}
          ],
          "where": {
            "and": [
              dateFilter,
              {"regex": {"result.test": ".*" + convert.String2RegExp(testName) + ".*"}}
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
        var name = combo.platform + (combo.build_type ? ("(" + combo.build_type + ")") : "") + " " + combo.suite.toUpperCase() + ":" + combo.test;
        chartArea.append(CHART_TEMPLATE.expand({"num": i, "name":name}));
        combo.count = undefined;
        //PULL DATA AND SHOW CHART
        (function(i){
            showOne("chart" + i, combo, dateFilter);
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
            {"name": "duration", "value": "result.duration"},
            {"name": "test", "value": "result.test"},
            {"name": "platform", "value": "build.platform"},
            {"name": "build_type", "value": "build.type"},
            {"name": "build_date", "value": "build.date"},
            {"name": "branch", "value": "build.branch"},
            {"name": "revision", "value": "build.revision12"},
            {"name": "ok", "value": "result.ok"}
          ],
          "where": {
            "and": [
              {"neq":{"build.branch":"try"}},
              dateFilter,
              {"eq": group}
            ]
          },
          "limit": (DEBUG ? 100 : 100000),
          "format": "list"
        }));
      } catch (e) {
        Log.error("Problem collecting test results from ActiveData", e);
      } finally {
        Log.actionDone(a);
      }//try

      a = Log.action("Make chart", true);
      try {
        //SORT REVISIONS BY build_date
        var revisions = (yield(qb.calc2List({
          "from": result.data,
          "select": {"value": "build_date", "aggregate": "min"},
          "edges": ["revision"],
          "sort": "build_date"
        })));
        revisions = revisions.list.select("revision");

        var duration = (yield(Q({
          "from": result.data,
          "select": [
            {"name": "build_date", "value": "Date.newInstance(build_date)", "aggregate": "min"},
            {
              "name": "duration",
              "value": {
                "when": "build_date",
                "then": {"coalesce": ["duration", -1]}
              },
              "aggregate": "average"
            }
          ],
          "edges": [
            {
              "name": "result",
              "value": {
                "when": "duration",
                "then": "ok",
                "else": {"literal": "incomplete"}
              },
              "domain": {
                "type": "set", "partitions": [
                  {"name": "pass", "value": true, "style": {"color": "#1f77b4"}},
                  {"name": "fail", "value": false, "style": {"color": "#ff7f0e"}},
                  {"name": "incomplete", "value": "incomplete", "style": {"color": "#d62728"}}
                ]
              }
            },
            {"value": "revision", "domain": {"partitions": revisions}}
          ],
          "meta": {"format": "list"}
        })));

        //ENSURE WE HAVE A duration FOR ALL ROWS
        duration.data.forall(function(v){
          if (v.build_date == null) {
            v.duration = -1;
          }//endif
        });

        aChart.showScatter({
          "target": target,
          "data": duration,
          "series": [
            {
              "axis": "color",
              "value": {
                "case": [
                  {"when": {"missing": " duration"}, "then": {"literal": "incomplete"}},
                  {"when": "ok", "then": {"literal": "pass"}, "else": {"literal": "fail"}}
                ]
              }
            }
          ],
          "axis": {
            "x": {
              "format": "{{.|format('NNN dd, HH:mm')}}",
              "size": 50,
              "value": "build_date"
            },
            "color":{
              "domain": {
                "type": "set", "partitions": [
                  {"name": "pass", "value": true, "style": {"color": "#1f77b4"}},
                  {"name": "fail", "value": false, "style": {"color": "#ff7f0e"}},
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
