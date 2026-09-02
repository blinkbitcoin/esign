# CI-owned branch

badges/<branch>/coverage.{svg,json} - written by the Coverage badge job in
.github/workflows/test.yml; badges/<branch>/{unit,e2e}.{svg,json} - by the
Status badges job in ci.yml. Both run on every CI run; a PR's directory is
removed when it closes.
Do not edit by hand.
