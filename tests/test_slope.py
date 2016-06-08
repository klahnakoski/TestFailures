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

from tempfile import NamedTemporaryFile

import app
from pyLibrary.debugs import startup, constants
from pyLibrary.debugs.logs import Log
from pyLibrary.testing.elasticsearch import Fake_ES
from pyLibrary.testing.fuzzytestcase import FuzzyTestCase
from pyLibrary.times.dates import Date

CONFIG_FILE = "tests/resources/config/testing.json"

class TestSlope(FuzzyTestCase):
    def setUp(self):
        config = startup.read_settings(filename=CONFIG_FILE)
        Log.start(config.debug)
        constants.set(config.constants)
        app.config=config

    def tearDown(self):
        Log.stop()

    def test_positive_slope(self):
        temp = NamedTemporaryFile(delete=False)
        es = Fake_ES(filename=temp.name)

        app.agg(
            Date("1 jun 2016"),
            es,
            debug_filter={"and": [
                {"prefix": {"run.suite": "mochitest-browser-chrome"}},
                {"eq": {"build.type": "opt"}},
                {"eq": {"result.test": "browser/components/uitour/test/browser_UITour_heartbeat.js"}},
                {"eq": {"build.platform": "win64"}}
            ]}
        )

        self.assertTrue(es.data.items()[0][1].slope > 0, "Expecting positive slope")

