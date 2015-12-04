
importScript("../modevlib/charts/mgChart.js");
importScript("../modevlib/layouts/dynamic.js");
importScript("../modevlib/layouts/layout.js");
importScript("../modevlib/collections/aMatrix.js");


var FAIL_PREFIX = "failure_";
var currentClicker=null;
var FROM_DATE = Date.today().subtract(Duration.WEEK);
var RECENT_DATE = Date.today().subtract(Duration.DAY);
var TO_DATE = Date.now().floor(Duration.DAY);
var NOW = Date.now();
var REMOVE_BUTTON_CLASS = "x";

var tests = {};  //MAP FROM FULL NAME TO UNIQUE TEST
window.exclude = [];  //STUFF TO IGNORE


function addExclusion(column, removeText){
	$("#removes").append('<div class="removable">'+removeText+'</div>');
}//function


var add_remove_button = function(element){
//	element = $(element);
	var rawID = Util.UID();
	var id = "remove_" + rawID;

	var BUTTON = new Template(
		'<div id={{id|quote}} layout="mr=..mr" style="display:none;height:20px;width=25px;padding-right: 5px">' +
		'<img src="images/x-3x.png">' +
		'</div>'
	);
	element.append(BUTTON.expand({"id": id}));

	// CLICK WILL ADD RESULTS TO EXCLUDE LIST
	$("#"+id).click(function(e){
		var self = $(this);
		var removeText = self.parent().text();
		var column = self.parent().attr("columnName");

		var exclude = Session.get("exclude");
		if (!exclude.contains(removeText)) {
			exclude.append(removeText);
		}//endif

		//ADD REMOVE TO URL
		Session.URL.set("exclude", exclude);

		//REMOVE ALL ROWS WITH GIVEN removeText
		$("#details").find("tr").each(function(){
			var self=$(this);
			var text=self.text();

			if (Array.OR(exclude.map(function(e){
				return text.indexOf(e)>0;
			}))){
				self.hide();
			}//endif
		});

		//ADD REMOVE TO LIST OF REMOVES
		addExclusion(column, removeText);
		e.stopPropagation();
	});

	// SHOW BUTTON DURING HOVER
	element.hover(function(){
		$("#"+id).show();
	}, function(){
		$("#"+id).hide();
	});

	$(element).updateDynamic();
};


var chart = function*(testGroup){

	var a = Log.action("Wait for detailed data", true);
	try {
		if (testGroup.thread !== undefined) {
			yield (Thread.join(testGroup.thread));
		}//endif
	}catch (e){
		Log.warning("chart cancelled", e);
	} finally {
		Log.actionDone(a)
	}//try

	a = Log.action("Make chart", true);
	try {
		//SORT REVISIONS BY build_date
		var revisions = (yield(Qb.calc2List({
			"from": testGroup.details,
			"select": {"value": "build_date", "aggregate": "min"},
			"edges": ["revision"],
			"sort": "build_date"
		})));
		revisions = revisions.list.select("revision");

		var duration = (yield(Q({
			"from": testGroup.details,
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
			"target": "chart",
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
};//function

// ALL TESTS RESULTS FOR TESTS IN LIST testGroups
var getDetails = function*(group, testGroups){
	var a = Log.action("get details #" + group, true);
	try {
		//PULL SUCCESS
		var success = yield (search({
			"from": "unittest",
			"select": [
				"_id",
				{"name": "duration", "value": "result.duration"},
				{"name": "suite", "value": "run.suite"},
				{"name": "chunk", "value": "run.chunk"},
				{"name": "test", "value": "result.test"},
				{"name": "platform", "value": "build.platform"},
				{"name": "build_type", "value": "build.type"},
				{"name": "build_date", "value": "build.date"},
				{"name": "branch", "value": "build.branch"},
				{"name": "revision", "value": "build.revision12"},
				{"name": "ok", "value": "result.ok"}
			],
			"where": {"and": [
				{"gte": {"build.date": FROM_DATE.unix()}},
				{"lt": {"build.date": TO_DATE.unix()}},
				{"eq": {"build.branch": "mozilla-inbound"}},
				{"or": testGroups.map(function(r){
					return {"eq": {
						"run.suite": r.suite,
						"result.test": r.test,
						"build.platform": r.platform,
						"build.type": r.build_type
					}}
				})}
			]},
			"limit": 100000,
			"format": "list"
		}));

		addGroupId(success, ["suite", "test", "platform", "build_type"]);

		var groupedSuccesses = (yield (Qb.calc2List({
			"from": success.data,
			"select": [
				{"name": "last_good", "value": "build_date", "aggregate": "max"},
				{"name": "details", "value": ".", "aggregate": "list"},
				{"value": "_group_id", "aggregate": "one"},
				{"name": "success_count", "value": ".", "aggregate": "count"}
			],
			"edges": ["suite", "test", "platform", "build_type"],
			"meta": {"format": "cube"}
		}))).list;


		//CALCULATE THE TOTAL WEIGHT TO NORMALIZE THE TEST SCORES {1 - (age/7)}
		//INSERT THIS NEW INFO TO OUR MAIN DATA STRUCTURE
		groupedSuccesses.forall(function(s){
			var test_group = tests[s._group_id];
			test_group.last_good = s.last_good;
			test_group.details.extend(s.details);
			test_group.success_count = s.success_count;

			var is_done = {};  //THERE ARE SUBTESTS IN THE details, ONLY COUNT THE TEST ONCE
			var failure_score = 0;
			var total_score = 0;
			test_group.details.forall(function(d){
				if (!is_done[d._id]) {
					is_done[d._id] = true;
					var score = 1 - NOW.subtract(Date.newInstance(d.build_date)).divideBy(Duration.DAY) / 7;
					if (score < 0) score = 0;
					if (!d.ok) {
						failure_score += score;
					}//endif
					total_score += score;
				}//endif
			});
			test_group.total_score = total_score;
			test_group.failure_score = failure_score;
			if (total_score != 0) {
				test_group.score = failure_score / total_score;
			}//endif

			$("#" + FAIL_PREFIX + test_group.rownum+" td")
				.first()
				.html("" + aMath.round(test_group.score*100, {digits: 2}));
		});
	} finally {
		Log.actionDone(a);
	}//try
	yield (null);
};//function


var addGroupId = function(g, edges){
	g.data.forall(function(t){
		t._group_id = edges.map(function(e){
			return t[e];
		}).join("::");
	});
};


function showFailureTable(testGroups){
	var header = '<tr>' +
		'<th>Score</th>' +
		'<th>Last Fail</th>' +
		'<th>Fail Count</th>' +
		'<th>Suite</th>' +
		'<th>Test</th>' +
		'<th>Platform</th>' +
		'<th>Build Type</th>' +
		'<th style="width:200px;">Subtests</th>' +
		'</tr>';

	var ROW_TEMPLATE = new Template('<tr class="hoverable" id="' + FAIL_PREFIX + '{{rownum}}">' +
		'<td>{{score}}</td>' +
		'<td>{{last_fail|datetime}}</td>' +
		'<td>{{failure_count|html}}</td>' +
		'<td columnName="run.suite" class="deletable">{{suite|html}}</td>' +
		'<td columnName="result.test" class="deletable">{{test|html}}</td>' +
		'<td columnName="build.platform" class="deletable">{{platform|html}}</td>' +
		'<td columnName="build.type" class="deletable">{{build_type|html}}</td>' +
		'<td style="width:200px;">{{subtests|json|html}}</td>' +
		'</tr>'
	);

	body = testGroups.map(function(g, i){
		g.rownum=i;
		g.score = coalesce(g.score, "");
		return ROW_TEMPLATE.expand(g);
	}).join("");

	$("#details").html(
		'<table class="table">' +
		header +
		body +
		'</table>'
	);

	//ADD CLICKERS
	testGroups.forall(function(g){
		var id = g.rownum;
		$("#" + FAIL_PREFIX + id).click(function(e){
			if (currentClicker){
				currentClicker.kill();
			}//endif
			$("#chart").html("");
			var id = convert.String2Integer($(this).attr("id").substring(FAIL_PREFIX.length));
			var g=testGroups[id];

			if (!g.thread){
				g.thread = new Thread(function*(){
					yield (getDetails(0, [g]));
				});
				g.thread.start();
			}//endif

			currentClicker = Thread.run(chart(g));
		});
	});

	//ADD REMOVE BUTTONS
	$("#details").find("td").each(function(){
		var self = $(this);
		if (self.attr("columnName")){
			add_remove_button(self);
		}
	});
	layoutAll();

}//function

