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
from pyLibrary.dot import coalesce, wrap
from pyLibrary.env import elasticsearch, http
from pyLibrary.queries import jx
from pyLibrary.thread.threads import Thread, Signal
from pyLibrary.times.dates import Date
from pyLibrary.times.durations import WEEK, DAY

SUITES = ["mochitest", "web-platform-tests", "reftest", "xpcshell", ]
EXCLUDE_PLATFORMS = []
EXCLUDE_BRANCHES = ["try"]

config = None

def agg(today, destination, please_stop):
    """
    :param today:  The day we are performing the calculation for
    :param destination: The ES index where we put the results
    :param please_stop: Signal for stopping early
    :return: nothing
    """

    # GET LIST OF ALL TESTS, BY PLATFORM, TYPE, SUITE
    for suite in SUITES:
        domain = {"and": [
            {"prefix": {"run.suite": suite}},
            {"gt": {"build.date": (today - 3 * DAY).unix}},
            {"lt": {"build.date": (today + 4 * DAY).unix}},
            {"not": {"in": {"build.platform": EXCLUDE_PLATFORMS}}},
            {"not": {"in": {"build.branch": EXCLUDE_BRANCHES}}},
            {"eq": {"result.ok": False}}
        ]}

        # WE CAN NOT PULL ALL TESTS, THERE ARE TOO MANY, SO DO ONE SUITE AT A TIME
        Log.note("Get summary of failures in {{suite}} for date {{date}}", suite=suite, date=today)
        suite_summary = http.post_json(config.source.url, json={
            "from": "unittest",
            "groupby": [
                {"name": "test", "value": "result.test"}
            ],
            "where": domain,
            "format": "list",
            "limit": 100000
        })

        often_fail = jx.filter(suite_summary.data, {"gt": {"count": 1}})

        for g, tests in jx.groupby(often_fail, size=100):
            tests = wrap(tests)
            if please_stop:
                return

            Log.note("Collect stats on {{num}} tests", num=len(tests))
            tests_summary = http.post_json(config.source.url, json={
                "from": "unittest",
                "groupby": [
                    "run.suite",
                    {"name": "test", "value": "result.test"},
                    "build.platform",
                    "build.type",
                    "run.type"
                ],
                "select": [
                    {
                        "name": "date_fails",
                        "value": {
                            "mult": [
                                {"div": [{"sub": {"build.date": today + 0.5 * DAY}}, DAY.seconds]},
                                {"when": "result.ok", "then": 0, "else": 1}
                            ]
                        },
                        "aggregate": "stats"
                    },
                    {"name": "date", "value": {"div": {"build.date": DAY.seconds}}, "aggregate": "stats"},
                    {"name": "fails", "value": {"when": "result.ok", "then": 0, "else": 1}, "aggregate": "stats"}
                ],
                "where": {"and": [
                    domain,
                    {"in": {"result.test": tests}}
                ]},
                "format": "list",
                "limit": 100000
            })

            # FOR EACH TEST, CALCULATE THE "RECENTLY BAD" STATISTIC (linear regression slope)
            # THIS IS ONLY A ROUGH CALC FOR TESTING THE UI
            for t in tests_summary.data:
                t._id = "-".join([t.build.platform, coalesce(t.build.type, ""), coalesce(t.run.type, ""), t.run.suite, t.test, unicode(today.unix)])
                t.timestamp = today
                t.average = t.fails.avg
                if t.date.var == 0:
                    t.slope = 0
                else:
                    t.slope = (t.date_fails.avg - t.date.avg * t.fails.avg) / t.date.var
                t.etl.timestamp = Date.now()

            # PUSH STATS TO ES
            docs = [{"id": t._id, "value": t} for t in tests_summary.data if t.fails.sum > 0]
            Log.note("Adding {{num}} test summaries", num=len(docs))
            destination.extend(docs)


def loop_all_days(destination, please_stop):
    today = Date.today()

    # WHICH DAYS DO WE NEED TO CALCULATE
    # ALL BUILD DATES WITH WITH ETL TIMESTAMP OF A WEEK AGO
    # ALL BUILD DATES THAT HAVE NOT BEEN PROCESSED YET
    build_dates = http.post_json(config.source.url, json={
        "from": "unit",

        "edges": [
            {
                "name": "date",
                "value": "build.date",
                "allowNulls": False,
                "domain": {
                    "type": "time",
                    "min": "today-week",
                    "max": "eod",
                    "interval": "day"
                }
            }
        ],
        "where": {"gte": {"etl.timestamp": (today - WEEK).unix}},
        "sort": {"value": "build.date", "sort": -1},
        "limit": 14,
        "format": "list"
    })

    for d in build_dates.data:
        if please_stop:
            return
        agg(Date(d.date), destination, please_stop)
    please_stop.go()


def main():
    global config

    try:
        config = startup.read_settings()
        with startup.SingleInstance(flavor_id=config.args.filename):
            constants.set(config.constants)
            Log.start(config.debug)

            es = elasticsearch.Cluster(config.destination).get_or_create_index(config.destination)

            please_stop = Signal()
            Thread.run("aggregator", loop_all_days, es, please_stop=please_stop)
            Thread.wait_for_shutdown_signal(please_stop=please_stop, allow_exit=True)
    except Exception, e:
        Log.error("Serious problem with Test Failure Aggregator service!  Shutdown completed!", cause=e)
    finally:
        Log.stop()

    sys.exit(0)


if __name__ == '__main__':
    main()


