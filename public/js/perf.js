importScript("../modevlib/charts/mgChart.js");
importScript("../modevlib/layouts/dynamic.js");
importScript("../modevlib/layouts/layout.js");
importScript("../modevlib/collections/aMatrix.js");


var _perf_search;

(function(){

  var DEBUG=true;

  var CHART_TEMPLATE = new Template(
    '<div style="padding-top:10px;">' +
    '<h3>{{platform}} {{suite}}</h3>' +
    '{{test}}'+
    '<div id="chart{{num}}" class="chart" style="height:300px;width:800px;"></div>' +
    '</div>');

  var HOVER = new Template(
    '<b>Branch:</b> {{branch}}<br>' +
    '<b>Build Date:</b> {{build_date|format("NNN dd, HH:mm:ss")}}<br>' +
    '<b>Revision:</b> {{revision|left(12)}}<br>' +
    '<b>Duration:</b> {{duration|round(3)}} seconds<br>'
  );

  var debugFilter = {"eq": {"build.platform": "win32", "result.test":"ext.html.30"}};

  _perf_search = function(suiteName, dateRange){
    partitions

    Thread.run(function*(){

      Thread.run(function*(){
        //WHAT DIMENSION ARE WE SHOWING?
        var a = Log.action("Find platforms.  This will take a while...", true);
        try {
          var partitions = yield (query({
            "from": "perf",
            "groupby": [
              "run.suite",
              "run.type",
              "result.test",
              "build.platform",
              "build.type"
            ],
            "where": {
              "and": [
                {"gte": {"build.date": dateRange.min.unix()}},
                {"lt": {"build.date": dateRange.max.unix()}},
                {"eq": {"run.suite": suiteName}},
                DEBUG ? debugFilter : true
              ]
            },
            "limit": 100,
            "format": "list"
          }));
        } finally {
          Log.actionDone(a);
        }//try

        var chartArea = $("#charts");
        if (partitions.data.length == 0) {
          chartArea.html("Test not found, or never failed");
          return;
        }//endif
      });


      Thread.run(function*(){
        //WHAT DIMENSION ARE WE SHOWING?
        var a = Log.action("Find platforms.  This will take a while...", true);
        try {
          var partitions = yield (query({
            "from": "perf",
            "groupby": [
              "run.suite",
              "run.type",
              "result.test",
              "build.platform",
              "build.type"
            ],
            "where": {
              "and": [
                {"gte": {"build.date": dateRange.min.unix()}},
                {"lt": {"build.date": dateRange.max.unix()}},
                {"eq": {"run.suite": suiteName}},
                DEBUG ? debugFilter : true
              ]
            },
            "limit": 100,
            "format": "list"
          }));
        } finally {
          Log.actionDone(a);
        }//try

        var chartArea = $("#charts");
        if (partitions.data.length == 0) {
          chartArea.html("Test not found");
          return;
        }//endif
      });


      Thread.run(function*(){
        chartArea.html("");
        partitions.data.forall(function(combo, i){
          if (DEBUG && i>0) return;
          if (i>100) return;
          var platform = combo.build.platform + (combo.build.type ? (" (" + combo.build.type + ")") : "");
          var suite = combo.run.suite + (combo.run.type ? (" (" + combo.run.type + ")") : "");
          var test = combo.result.test;
          chartArea.append(CHART_TEMPLATE.expand({"num": i, "platform": platform, "suite": suite, "test": test}));
          combo.count = undefined;
          //PULL DATA AND SHOW CHART
          (function(i){
            showOne("chart" + i, Map.zip(Map.leafItems(combo)), dateRange);
          })(i);
        });
      });




    });
  };//function


  function showOne(target, group, dateRange){
    Thread.run(function*(){

      var a = Log.action("find test results", true);
      try {
        //PULL FAILURE DETAILS
        var result = yield (query({
          "from": "perf",
          "select": [
            "_id",
            {"name": "suite", "value": "run.suite"},
            {"name": "duration", "value": "result.stats.median"},
            {"name": "test", "value": "result.test"},
            {"name": "platform", "value": "build.platform"},
            {"name": "build_type", "value": "build.type"},
            {"name": "build_date", "value": "build.date"},
            {"name": "branch", "value": "build.branch"},
            {"name": "revision", "value": "build.revision12"}
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
          "limit":100000,
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
              "value": "duration"
            },
            "color":{
              "value": "branch",
              "domain": {
                "type": "set",
                "partitions": Array.union(result.data.select("branch"))
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
