# encoding: utf-8
#
#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this file,
# You can obtain one at http://mozilla.org/MPL/2.0/.
#
# Author: Kyle Lahnakoski (kyle@lahnakoski.com)
#
from __future__ import absolute_import
from __future__ import division
from __future__ import unicode_literals

import sys

from pyLibrary.debugs import constants
from pyLibrary.debugs import startup
from pyLibrary.debugs.logs import Log
from pyLibrary.dot import coalesce
from pyLibrary.env import elasticsearch, http
from pyLibrary.queries import qb
from pyLibrary.thread.threads import Thread, Signal
from pyLibrary.times.dates import Date
from pyLibrary.times.durations import WEEK

ACTIVEDATA = "http://activedata.allizom.org/query"
SUITES = ["mochitest"]
EXCLUDE_PLATFORMS = []


config = None


def agg(destination, please_stop):
    # GET LIST OF ALL TESTS, BY PLATFORM, TYPE, SUITE

    for suite in SUITES:
        # WE CAN NOT PULL ALL TESTS, THERE ARE TOO MANY, SO DO ONE SUITE AT A TIME
        suite_summary = http.post_json(ACTIVEDATA, json={
            "from": "unittest",
            "groupby": [
                {"name": "test", "value": "result.test"}
            ],
            "where": {"and": [
                {"prefix": {"run.suite": suite}},
                {"gt": {"build.date": (Date.today() - WEEK).unix}},
                {"not": {"in": {"build.platform": EXCLUDE_PLATFORMS}}},
                {"eq": {"result.ok": False}}
            ]},
            "format": "list",
            "limit": 100000
        })

        now = Date.today()

        for g, tests in qb.groupby(suite_summary.data, size=100):
            if please_stop:
                return

            tests_summary = http.post_json(ACTIVEDATA, json={
                "from": "unittest",
                "groupby": [
                    "build.platform",
                    "build.type",
                    "run.type",
                    "run.suite",
                    {"name": "test", "value": "result.test"}
                ],
                "select": [
                    {
                        "name": "xy",
                        "value": {
                            "mult": [
                                "build.date",
                                {"when": "result.ok", "then": 0, "else": 1}
                            ]
                        },
                        "aggregate": "stats"
                    },
                    {"name": "x", "value": "build.date", "aggregate": "stats"},
                    {"name": "y", "value": {"when": "result.ok", "then": 0, "else": 1}, "aggregate": "stats"}
                ],
                "where": {"and": [
                    {"prefix": {"run.suite": suite}},
                    {"gt": {"build.date": (Date.today() - WEEK).unix}},
                    {"not": {"in": {"build.platform": EXCLUDE_PLATFORMS}}},
                    {"in": {"result.test": tests.test}}
                ]},
                "format": "list",
                "limit": 100000
            })

            # FOR EACH TEST, CALCULATE THE "RECENTLY BAD" STATISTIC (linear regression slope)
            for t in tests_summary.data:
                t._id = t.build.platform + "-" + t.build.type + "-" + coalesce(t.run.type, "") + "-" + t.run.suite + "-" + t.test
                t.average = t.y.avg
                if t.x.var == 0:
                    t.slope = None
                else:
                    t.slope = (t.xy.avg - t.x.avg * t.y.avg) / t.x.var
                t.etl.timestamp = now

            # PUSH STATS TO ES
            destination.extend([{"id": t._id, "value": t} for t in tests_summary.data])
    please_stop.go()


def main():
    global config

    try:
        config = startup.read_settings()
        constants.set(config.constants)
        Log.start(config.debug)

        es = elasticsearch.Cluster(config.destination).get_or_create_index(config.destination)

        please_stop=Signal()
        Thread.run("aggregator", agg, es, please_stop=please_stop)
        Thread.wait_for_shutdown_signal(please_stop=please_stop, allow_exit=True)
    except Exception, e:
        Log.error("Serious problem with Test Failure Aggregator service!  Shutdown completed!", cause=e)
    finally:
        Log.stop()

    sys.exit(0)


if __name__ == '__main__':
    main()


