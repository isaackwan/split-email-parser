#!/bin/bash

set -e
source /home/yottadev48/nodevenv/domains/split-email-parser.apps.isaackwan.com/repo/24/bin/activate
cd /home/yottadev48/domains/split-email-parser.apps.isaackwan.com/repo
node src/pipe.js
