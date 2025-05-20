# Search Engine Project

Welcome to the Principal Engineer test project! Your task is to build a mini search engine specifically designed for searching programming documentation using existing technologies.

- We are looking for displays of technical skill, efficient time use, and good judgement.
- We grade relative to the aptitudes being displayed -- we don't expect all applicants to have domain knowledge of the project going into it.
- Note that our backend stack uses crystal, python, javascript and rust. It is OK to use other languages, but preferred to align with our existing stack if possible.
- Using AI to assist you in coding is fine. However, careless use of AI tools leading to sloppy code or solutions you don't fully understand will be disqualifying.
- Feel free to ask questions by email as needed.

## System architecture

- Select and implement a crawler to crawl over the pages listed at the bottom of this text
- The crawler should stay within the provided subdomain/domain/path restrictions.
- If you find that proxy use would be needed to improve crawling, you can skip this and explain how you would architect a crawler with proxying.

### Index

- Choose the database architecture of your choice for storing crawl results, indexing, and retrieving from indexed results. Please explain your decision in the project's README file. You can use a single database for everything, multiple databases, hand managed flat file pipelines, etc. as you wish.
- While this project is on a small amount of data, assume this would be built to scale in the range of 1PB for the amount of data being indexed.
- **The maximum allowable search latency is 50ms**. This should remain true if we scaled the DB to 1PB. Explain how you would scale your system, but you can implement a single-node version.
- Bonus points for supporting both a classical index as well as an embedding based retrieval over results.

## User Interface

- The final search engine should be deployed at a publicly accessible URL.
- Provide a simple interface for your search engine: an input box for the query and a display of the 10 most relevant search results. Each result should include the title, link, and a relevant snippet from the page.
- Display the query latency above the results.
- Include a basic page to show the number of indexed pages per domain, along with any other useful statistics you'd like to present.

## Documentation

1. Include documentation allowing us to build your project from scratch by following it. Include a link to a cloud drive/bucket to download relevant data as necessary, so we don't have to re-run a full crawl to replicate results.
2. Explain architectural choices you've made.
3. Describe the challenges you encountered during crawling, indexing, and ranking, as well as the solutions you implemented. We're interested in that. If you wasted 3 days on a dead path, tell us about it and what you learned.
4. Explain how you optimized ranking to achieve high relevancy in the search results.
5. We want the documentation to be concise and human readable. If you use AI to generate a README for you, spend the time to edit it and make it easy for us to review.

## Deliverables

1. A GitHub repository containing the project and accompanying documentation.
2. A live deployment of the search engine for testing. Prioritize both search relevancy and latency.

Good luck!

## Domains

You can limit your crawling to the following domains:

- angular.io
- api.drupal.org
- api.haxe.org
- api.qunitjs.com
- babeljs.io
- backbonejs.org
- bazel.build
- bluebirdjs.com
- bower.io
- cfdocs.org
- clojure.org
- clojuredocs.org
- codecept.io
- codeception.com
- codeigniter.com
- coffeescript.org
- cran.r-project.org
- crystal-lang.org
- forum.crystal-lang.org
- css-tricks.com
- dart.dev
- dev.mysql.com
- developer.apple.com
- developer.mozilla.org
- developer.wordpress.org
- doc.deno.land
- doc.rust-lang.org
- docs.astro.build
- docs.aws.amazon.com
- docs.brew.sh
- docs.chef.io
- docs.cypress.io
- docs.influxdata.com
- docs.julialang.org
- docs.microsoft.com
- docs.npmjs.com
- docs.oracle.com
- docs.phalconphp.com
- docs.python.org
- docs.rs
- docs.ruby-lang.org
- docs.saltproject.io
- docs.wagtail.org
- doctrine-project.org
- docwiki.embarcadero.com
- eigen.tuxfamily.org
- elixir-lang.org
- elm-lang.org
- en.cppreference.com
- enzymejs.github.io
- erights.org
- erlang.org
- esbuild.github.io
- eslint.org
- expressjs.com
- fastapi.tiangolo.com
- flow.org
- fortran90.org
- fsharp.org
- getbootstrap.com
- getcomposer.org
- git-scm.com
- gnu.org
- gnucobol.sourceforge.io
- go.dev
- golang.org
- graphite.readthedocs.io
- groovy-lang.org
- gruntjs.com
- handlebarsjs.com
- haskell.org
- hex.pm
- hexdocs.pm
- httpd.apache.org
- i3wm.org
- jasmine.github.io
- javascript.info
- jekyllrb.com
- jsdoc.app
- julialang.org
- knockoutjs.com
- kotlinlang.org
- laravel.com
- latexref.xyz
- learn.microsoft.com
- lesscss.org
- love2d.org
- lua.org
- man7.org
- mariadb.com
- mochajs.org
- modernizr.com
- momentjs.com
- mongoosejs.com
- next.router.vuejs.org
- next.vuex.vuejs.org
- nginx.org
- nim-lang.org
- nixos.org
- nodejs.org
- npmjs.com
- ocaml.org
- odin-lang.org
- openjdk.java.net
- opentsdb.net
- perldoc.perl.org
- php.net
- playwright.dev
- pointclouds.org
- postgresql.org
- prettier.io
- pugjs.org
- pydata.org
- pytorch.org
- qt.io
- r-project.org
- react-bootstrap.github.io
- reactivex.io
- reactjs.org
- reactnative.dev
- reactrouterdotcom.fly.dev
- readthedocs.io
- readthedocs.org
- redis.io
- redux.js.org
- requirejs.org
- rethinkdb.com
- ruby-doc.org
- ruby-lang.org
- rust-lang.org
- rxjs.dev
- sass-lang.com
- scala-lang.org
- scikit-image.org
- scikit-learn.org
- spring.io
- sqlite.org
- stdlib.ponylang.io
- superuser.com
- svelte.dev
- swift.org
- tailwindcss.com
- twig.symfony.com
- typescriptlang.org
- underscorejs.org
- vitejs.dev
- vitest.dev
- vuejs.org
- vueuse.org
- webpack.js.org
- wiki.archlinux.org
- www.chaijs.com
- www.electronjs.org
- www.gnu.org
- www.hammerspoon.org
- www.khronos.org
- www.lua.org
- www.php.net/manual/en/
- www.pygame.org
- www.rubydoc.info
- www.statsmodels.org
- www.tcl.tk
- www.terraform.io
- www.vagrantup.com
- www.yiiframework.com
- yarnpkg.com
- 
