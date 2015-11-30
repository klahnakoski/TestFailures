/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */



function* ESQueryRunner(query){
	var data;
	try {
		yield(ESQuery.loadColumns(query));
		var cubeQuery = new ESQuery(query);
		data = yield(cubeQuery.run());
		yield (data);
	} catch (e) {
		if (!e.contains(ESQuery.NOT_SUPPORTED)) Log.error("Problem sending query", e);
		//USE THE ACTIVE DATA SERVICE
		data = yield (ActiveDataQuery(query));
		yield (data);
	}//try
}//method


function* ActiveDataQuery(query){
	//USE THE ACTIVE DATA SERVICE
	try {
		var response = yield(Rest.post({
			"url": "/query",
			"data": convert.value2json(query)
		}));

		yield (response);
	} catch (e) {
		Log.error("Call to ActiveData failed", e)
	}//try
}//method


importScript([
	"../modevlib/aLibrary.js",
	"../modevlib/qb/ESQuery.js"
], function(){
	return "done";
});
