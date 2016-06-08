importScript("../modevlib/charts/mgChart.js");
importScript("../modevlib/layouts/dynamic.js");
importScript("../modevlib/layouts/layout.js");
importScript("../modevlib/collections/aMatrix.js");


var _search;

(function(){

  var DEBUG=false;

  var MAX_TESTS_PER_PAGE = 100;
  var CHART_TEMPLATE = new Template(
    '<div style="padding-top:10px;">' +
    '<h3>{{product|upper}} - {{platform}} {{suite}} ({{fail_rate|percent}} failures)</h3>' +
    '{{test}}'+
    '<div id="chart{{num}}" class="chart" style="height:300px;width:800px;"></div>' +
    '</div>');

  var HOVER = new Template(
    '<b>{{status|upper}}</b><br>' +
    '<b>Branch:</b> {{branch}}<br>' +
    '<b>Build Date:</b> {{build_date|format("NNN dd, HH:mm:ss")}}<br>' +
    '<b>Revision:</b> {{revision|left(12)}}<br>' +
    '<b>Duration:</b> {{duration|round(3)}} seconds<br>'+
    '<b>Chunk:</b> {{chunk}}'
  );

  var debugFilter = true;
  //var debugFilter = {"eq": {
  //  "build.platform": "linux",
  //  "build.type": "pgo",
  //  "run.suite": "mochitest-other"
  //}};

  _search = function(testName, dateRange){

    Thread.run("search", function*(){

      var a = Log.action("Find platforms...", true);
      var partitions = yield (query({
        "select": [
          {"value": "fails.sum", "aggregate": "sum"},
          {"value": "fails.count", "aggregate":"sum"}
        ],
        "from": "failures",
        "groupby": [
          "build.product",
          "run.suite",
          "run.type",
          "test",
          "build.platform",
          "build.type"
        ],
        "where": {
          "and": [
            {"gte": {"timestamp": dateRange.min.unix()}},
            {"lte": {"timestamp": dateRange.max.unix()}},
            {"regex": {"test": ".*" + convert.String2RegExp(testName) + ".*"}},
            DEBUG ? debugFilter : true
          ]
        },
        "limit": 100,
        "sort": {"value": "fails.sum", "sort": -1},
        "format": "list"
      }));
      Log.actionDone(a);

      partitions.data.forall(function(d){
        d.fails.avg = d.fails.sum / d.fails.count;
      });

      // JUST IN CASE ActiveData DID NOT SORT
      partitions.data = qb.sort(partitions.data, {"value": "fails.avg", "sort": -1});

      try{
        var chartArea = $("#charts");
        if (partitions.data.length>MAX_TESTS_PER_PAGE) {
          chartArea.html(partitions.data.length + " is too many combinations");
          return;
        }else if (partitions.data.length==0){
          chartArea.html("Test not found");
          return;
        }//endif

        chartArea.html("");
        partitions.data.forall(function(combo, i){
          if (DEBUG && i>0) return;
          var product = combo.build.product;
          var platform = combo.build.platform + (combo.build.type ? (" (" + combo.build.type + ")") : "");
          var suite = combo.run.suite + (combo.run.type ? (" (" + combo.run.type + ")") : "");
          var test = combo.test;
          var fail_rate = combo.fails.avg;
          chartArea.append(CHART_TEMPLATE.expand({
            "num": i,
            "product":product,
            "platform": platform,
            "suite": suite,
            "test": test,
            "fail_rate": fail_rate
          }));
          combo.count = undefined;
          combo.fails = undefined;

          if (i<=10){
            //PULL DATA AND SHOW CHART
            (function(i){
                showOne("chart" + i, Map.zip(Map.leafItems(combo)), dateRange);
            })(i);
          }else{
            $("#chart"+i).html("not shown to limit data pulled")
          }//endif
        });

      } finally {
        Log.actionDone(a);
      }//try

    });


  };//function


  function showOne(target, group, dateRange){
    Thread.run(function*(){

      var sillyName = Map.map(group, function(k, v){
        if (k == "test") return undefined;
        return v;
      }).join("::");
      var a = Log.action("find " + sillyName, true);
      try {
        //PULL FAILURE DETAILS
        var result = yield (query({
          "from": "unittest",
          "select": [
            "_id",
            {"name": "suite", "value": "run.suite"},
            {"name": "chunk", "value": "run.chunk"},
            {"name": "duration", "value": {"coalesce":["result.duration", -1]}},
            {"name": "test", "value": "test"},
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
              {"gte": {"build.date": dateRange.min.unix()}},
              {"lt": {"build.date": dateRange.max.unix()}},
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
      if (result.data.length==0){
        $("#"+target).html("no data");
        return;
      }//endif


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
              "value": "build_date",
              "range": dateRange
            },
            "y":{
              "value": "duration",
              "range":{"max":aChart.maxNice(result.data.select("duration"))}
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


})();
