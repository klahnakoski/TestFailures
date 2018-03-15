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

from jx_python import jx
from mo_dots import wrap, coalesce
from mo_future import text_type
from mo_json import value2json
from mo_logs import Log, startup, constants
from mo_threads import Signal, Thread
from mo_times import DAY, Date, WEEK
from pyLibrary.env import http, elasticsearch

SUITES = ["mochitest", "web-platform-tests", "xpcshell"]
EXCLUDE_PLATFORMS = []
EXCLUDE_BRANCHES = ["try"]

DEBUG_TEST = None  # "toolkit/components/sqlite/tests/xpcshell/test_sqlite_internal.js"

config = None


def agg(today, destination, debug_filter=None, please_stop=None):
    """
    :param today:  The day we are performing the calculation for
    :param destination: The ES index where we put the results
    :param debug_filter: Some extra limitation to go faster, and focus, for testing
    :param please_stop: Signal for stopping early
    :return: nothing
    """

    # GET LIST OF ALL TESTS, BY PLATFORM, TYPE, SUITE
    for suite in SUITES:
        domain = {"and": [
            {"prefix": {"run.suite": suite}},
            {"gt": {"build.date": today.unix}},
            {"lt": {"build.date": (today+DAY).unix}},
            {"exists": "build.platform"},
            {"not": {"in": {"build.platform": EXCLUDE_PLATFORMS}}},
            {"not": {"in": {"build.branch": EXCLUDE_BRANCHES}}}
        ]}
        if debug_filter:
            domain['and'].append(debug_filter)

        _ = value2json('""')

        # WE CAN NOT PULL ALL TESTS, THERE ARE TOO MANY, SO DO ONE SUITE AT A TIME
        Log.note("Get summary of tests in {{suite}} for date {{date}}", suite=suite, date=today)
        suite_summary = http.post_json(config.source.url, json={
            "from": "unittest",
            "groupby": [
                {"name": "test", "value": "result.test"}
            ],
            "where": {"and": [
                domain
            ]},
            "format": "list",
            "limit": 100000
        })

        for g, tests in jx.groupby(suite_summary.data.test, size=100):
            tests = wrap(tests)
            if please_stop:
                return

            Log.note("Collect stats on {{num}} tests", num=len(tests))
            tests_summary = http.post_json(config.source.url, json={
                "from": "unittest",
                "groupby": [
                    "run.suite",
                    {"name": "test", "value": "result.test"},
                    "build.branch",
                    "build.platform",
                    "build.product",
                    "build.type",
                    "run.type"
                ],
                "select": [
                    {
                        "name": "fail",
                        "value": {"when": "result.ok", "then": 0, "else": 1},
                        "aggregate": "sum"
                    },
                    {
                        "name": "pass",
                        "value": {"when": "result.ok", "then": 1, "else": 0},
                        "aggregate": "sum"
                    },
                    {
                        "aggregate": "count"
                    }
                ],
                "where": {"and": [
                    domain,
                    {"in": {"result.test": tests}}
                ]},
                "format": "list",
                "limit": 10000
            })

            # FOR EACH TEST, CALCULATE THE "RECENTLY BAD" STATISTIC (linear regression slope)
            # THIS IS ONLY A ROUGH CALC FOR TESTING THE UI
            for t in tests_summary.data:
                try:
                    t._id = "-".join([
                        coalesce(t.build.product, ""),
                        t.build.branch,
                        t.build.platform,
                        coalesce(t.build.type, ""),
                        coalesce(t.run.type, ""),
                        t.run.suite,
                        t.test,
                        text_type(today.unix)
                    ])
                except Exception as e:
                    Log.error("text join problem", cause=e)
                t.timestamp = today
                # t.average = t.fail / t.count
                t.etl.timestamp = Date.now()

            # PUSH STATS TO ES
            docs = [{"id": t._id, "value": t} for t in tests_summary.data]
            Log.note("Adding {{num}} test summaries", num=len(docs))
            destination.extend(docs)


def loop_all_days(destination, please_stop):
    try:
        today = Date.today()

        # WHICH DAYS DO WE NEED TO CALCULATE
        # ALL BUILD DATES WITH WITH ETL TIMESTAMP OF A WEEK AGO
        # ALL BUILD DATES THAT HAVE NOT BEEN PROCESSED YET
        build_dates = http.post_json(config.source.url, json={
            "from": "unittest",
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

        build_dates.data = jx.sort(build_dates.data, {"value": "date", "sort": -1})

        for d in build_dates.data:
            if please_stop:
                return
            agg(Date(d.date), destination, please_stop=please_stop)
    finally:
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
    except Exception as e:
        Log.error("Serious problem with Test Failure Aggregator service!  Shutdown completed!", cause=e)
    finally:
        Log.stop()


if __name__ == '__main__':
    main()


