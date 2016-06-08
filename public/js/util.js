/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */


importScript("../modevlib/aLibrary.js");
importScript("../modevlib/Settings.js");
importScript("../modevlib/MozillaPrograms.js");
importScript("../modevlib/qb/ESQuery.js");
importScript("../modevlib/charts/aColor.js");
importScript("../css/menu.css");
importScript("../modevlib/math/Stats.js");
importScript("../modevlib/qb/qb.js");


var query = function*(query){
  var output;
  output = yield (Rest.post({
    //url: "http://localhost:5000/query",
    url: "https://activedata.allizom.org/query",
    json: query
  }));
  yield (output);
};

function sidebarSlider(){
  var WIDTH = "320px";

  $("body").css("display", "block");

  $('.sidebar_name').click(function(){
    var self = $(this);
    if (self.hasClass("selected")) {
      self.removeClass("selected");
      $("#sidebar").css({"width": "0px"});
      dynamicLayout();
    } else {
      self.addClass("selected");
      $("#sidebar").css({"width": WIDTH});
      dynamicLayout();
    }//endif
  });
}
