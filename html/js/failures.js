
importScript("../modevlib/charts/mgChart.js");
importScript("../modevlib/layouts/dynamic.js");
importScript("../modevlib/layouts/layout.js");
importScript("../modevlib/collections/aMatrix.js");


var RECENT_DATE = Date.today().subtract(Duration.WEEK);
var TO_DATE = Date.now().floor(Duration.DAY);

var MAX_TESTS_PER_PAGE = 20;


var _search;

(function(){
	var cache={};
	var currentThread=null;
	var launched=false;

	var parse=function(terms){
		return terms.split(" ").map(function(s){return s.trim().length<2 ? undefined : s.trim();});
	};//function

	_search=function(terms){
		$("#num_found").html("");
		if (parse(terms).length<2) return;  // TOO SHORT
		if (currentThread && !launched) currentThread.kill(); //DO NOT GENERATE TOO MANY REQUESTS

		launched = false;
		currentThread = Thread.run(function*(){
			yield (Thread.sleep(300));  //DO NOT START TOO SOON
			launched = true;   // NOW THAT WE STARTED, DO NOT CANCEL
			var dimensions = cache[terms];
			if (!dimensions) {
				var words = parse(terms);

				var filter = {"and": ["build.type", "build.platform", "build.branch", "build.test", "build.suite"].map(function(k){
					return {"or": words.map(function(w){
						return {"regex": Map.newInstance(k, ".*" + w + ".*")};
					})};
				})};

				var action=Log.action("Searching...", true);
				try {
					dimensions = yield (search({
						"from": "unittest",
						"select": [
							{"name": "suite", "value": "run.suite", "aggregate": "cardinality"},
							{"name": "test", "value": "result.test", "aggregate": "cardinality"},
							{"name": "platform", "value": "build.platform", "aggregate": "cardinality"},
							{"name": "build_type", "value": "build.type", "aggregate": "cardinality"},
							{"name": "branch", "value": "build.branch", "aggregate": "cardinality"}
						],
						"where": {
							"and": [
								{"gte": {"run.timestamp": RECENT_DATE.unix()}},
								{"lt": {"run.timestamp": TO_DATE.unix()}},
								filter
							]
						},
						"limit": 10000,
						"format": "list"
					}));
					cache[terms] = dimensions;
				}finally {
					Log.actionDone(action);
				}//try
			}//endif

			var counts = dimensions.data;
			var estimate_total = Math.max(counts.suite, counts.test) * counts.platform * counts.build_type * counts.branch;

			if (Thread.currentThread==currentThread){
				$("#num_found").html(new Template("approximately {{estimate|comma}} matches so far").expand({"estimate": estimate_total}));
				if (estimate_total <= MAX_TESTS_PER_PAGE){
					yield showAll(filter, dimensions);
				}//endif
			}//endif
			yield (null);
		});
	};//function
})();


function showAll(filter, dimensions){
	//WHAT DIMENSION ARE WE SHOWING?
	var partitions = yield (search({
		"from": "unittest",
		"groupby":[
			{"name": "suite", "value": "run.suite"},
			{"name": "test", "value": "result.test"},
			{"name": "platform", "value": "build.platform"},
			{"name": "build_type", "value": "build.type"},
			{"name": "branch", "value": "build.branch"}
		],
		"where": {
			"and": [
				{"gte": {"run.timestamp": RECENT_DATE.unix()}},
				{"lt": {"run.timestamp": TO_DATE.unix()}},
				filter
			]
		},
		"limit": 1000,
		"format": "list"
	}));

	var CHART_TEMPLATE = new Template('<div id="chart{{num}}" class="chart"></div>');
	var chartArea = $("#charts");
	chartArea.html("");
	partitions.data.forall(function(combo, i){
		chartArea.append(CHART_TEMPLATE.expand({"num": i}));
		//PULL DATA AND SHOW CHART
		(function(i){
			Thread.run(function*(){
				showOne("chart"+i, combo);
			});
		})(i);
	});
}//function


function showOne(div_id, group){
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
					{"gte": {"run.timestamp": RECENT_DATE.unix()}},
					{"lt": {"run.timestamp": TO_DATE.unix()}},
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
		var revisions = (yield(Qb.calc2List({
			"from": result.data,
			"select": {"value": "build_date", "aggregate": "min"},
			"edges": ["revision"],
			"sort": "build_date"
		})));
		revisions = revisions.list.select("revision");

		var duration = (yield(Q({
			"from": result.data,
			"select": [
				{"name":"build_date", "value": "Date.newInstance(build_date)", "aggregate": "min"},
				{"name": "duration", "value": "((build_date!=null && duration==null) ? -1 : duration)", "aggregate": "average"}
			],
			"edges": [
				{
					"name":"result",
					"value": "(duration==null ? 'incomplete' : ok)",
					"domain":{"type":"set", "partitions":[
						{"name":"pass", "value":true, "style":{"color": "#1f77b4"}},
						{"name":"fail", "value":false, "style": {"color": "#ff7f0e"}},
						{"name":"incomplete", "value":"incomplete", "style": {"color": "#d62728"}}
					]}
				},
				{"value": "revision", "domain": {"partitions": revisions}}
			],
			"meta": {"format": "list"}
		})));

		//ENSURE WE HAVE A duration FOR ALL ROWS
		duration.data.forall(function(v){
			if (v.build_date == null){
				v.duration = -1;
			}//endif
		});

		aChart.showScatter({
			"target": div_id,
			"hover":{"format":{
				"x": "{{.|format('NNN dd, HH:mm')}}",
				"y": ", duration={{.|round(1)}}sec"
			}},
			"data": duration,
			"axis": {"x": {"format":"{{.|format('NNN dd, HH:mm')}}", "size": 50, "value":"build_date"}}
		});
	} finally {
		Log.actionDone(a);
	}//try

	yield (null);
}//function


var CACHE;
(function(){
	var cache = {};

	function _CACHE(func){
		if (String(retval) === '[object Generator]') {

		}else{

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
	CACHE=_CACHE;
})();
