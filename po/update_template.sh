#!/bin/bash

package_name=system-monitor
extension_uuid=$(grep -oP 'UUID *= *\K([^ ]+)$' ../Makefile)
author_name="Florent Mounier"
author_email=paradoxxx.zero@gmail.com

# NOTE: -j (join) is load-bearing: the runtime translates several strings via
# dynamic lookups (widget metadata names, color/metric names, style options)
# whose literals appear nowhere xgettext can see them. Joining keeps those
# msgids alive in the template; a clean regeneration would drop them and
# their translations would disappear from the compiled catalogs.
cd "$PWD/../$extension_uuid" || exit 1
xgettext -j -k_ -kN_ -kC_:1c,2 --from-code=UTF-8 \
    --package-name=$package_name \
    --msgid-bugs-address=$author_email \
    --copyright-holder="$(date +%Y) $author_name" \
    -o ../po/$package_name.pot \
    ./*.js widgets/*.js ui/*.ui
