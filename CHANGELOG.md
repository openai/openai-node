# Changelog

## 4.26.0 (2024-01-25)

Full Changelog: [v4.25.0...v4.26.0](https://github.com/openai/openai-node/compare/v4.25.0...v4.26.0)

### Features

* **api:** add text embeddings dimensions param ([#650](https://github.com/openai/openai-node/issues/650)) ([1b5a977](https://github.com/openai/openai-node/commit/1b5a977d0eef7f5cf97daf27333cbbeb6bb479f3))


### Chores

* **internal:** add internal helpers & improve build scripts ([#643](https://github.com/openai/openai-node/issues/643)) ([9392f50](https://github.com/openai/openai-node/commit/9392f50e47f26b16632c9eb12187ea7f8a565e09))
* **internal:** adjust ecosystem-tests logging in CI ([#646](https://github.com/openai/openai-node/issues/646)) ([156084b](https://github.com/openai/openai-node/commit/156084b8734194a5856612378115b948c82ec6e4))
* **internal:** don't re-export streaming type ([#648](https://github.com/openai/openai-node/issues/648)) ([4c4be94](https://github.com/openai/openai-node/commit/4c4be945fa3f54036183e2d0877060db47ea564b))
* **internal:** fix binary files ([#645](https://github.com/openai/openai-node/issues/645)) ([e1fbc39](https://github.com/openai/openai-node/commit/e1fbc396f4d1dd8ba980c25ba03b670dfed887a0))
* **internal:** minor streaming updates ([#647](https://github.com/openai/openai-node/issues/647)) ([2f073e4](https://github.com/openai/openai-node/commit/2f073e4e6c9cd0ff3ad434907da710704765a005))
* **internal:** pin deno version ([#649](https://github.com/openai/openai-node/issues/649)) ([7e4b903](https://github.com/openai/openai-node/commit/7e4b9039320e4ccbafb45f57dce273bedc9b7cb3))

## 4.25.0 (2024-01-21)

Full Changelog: [v4.24.7...v4.25.0](https://github.com/openai/openai-node/compare/v4.24.7...v4.25.0)

### Features

* **api:** add usage to runs and run steps ([#640](https://github.com/openai/openai-node/issues/640)) ([3caa416](https://github.com/openai/openai-node/commit/3caa4166b8abb5bffb4c8be1495834b7f16af32d))


### Bug Fixes

* allow body type in RequestOptions to be null ([#637](https://github.com/openai/openai-node/issues/637)) ([c4f8a36](https://github.com/openai/openai-node/commit/c4f8a3698dc1d80439131c5097975d6a5db1b4e2))
* handle system_fingerprint in streaming helpers ([#636](https://github.com/openai/openai-node/issues/636)) ([f273530](https://github.com/openai/openai-node/commit/f273530ac491300842aef463852821a1a27805fb))
* **types:** accept undefined for optional client options ([#635](https://github.com/openai/openai-node/issues/635)) ([e48cd57](https://github.com/openai/openai-node/commit/e48cd57931cd0e81a77b55653cb1f663111dd733))


### Chores

* **internal:** debug logging for retries; speculative retry-after-ms support ([#633](https://github.com/openai/openai-node/issues/633)) ([fd64971](https://github.com/openai/openai-node/commit/fd64971612d1d7fcbd8a63885d333485bff68ab1))
* **internal:** update comment ([#631](https://github.com/openai/openai-node/issues/631)) ([e109d40](https://github.com/openai/openai-node/commit/e109d40a5c02c5bf4586e54d92bf0e355d254c1b))

## 4.24.7 (2024-01-13)

Full Changelog: [v4.24.6...v4.24.7](https://github.com/openai/openai-node/compare/v4.24.6...v4.24.7)

### Chores

* **ecosystem-tests:** fix flaky vercel-edge, cloudflare-worker, and deno tests ([#626](https://github.com/openai/openai-node/issues/626)) ([ae412a5](https://github.com/openai/openai-node/commit/ae412a5f12e701e07e71bd9791c55a56858e8383))
* **ecosystem-tests:** fix typo in deno test ([#628](https://github.com/openai/openai-node/issues/628)) ([048ec94](https://github.com/openai/openai-node/commit/048ec943f8d12acba9829c35ebf0b2d3f24930c8))

## 4.24.6 (2024-01-12)

Full Changelog: [v4.24.5...v4.24.6](https://github.com/openai/openai-node/compare/v4.24.5...v4.24.6)

### Chores

* **ecosystem-tests:** fix flaky tests and remove fine tuning calls ([#623](https://github.com/openai/openai-node/issues/623)) ([258d79f](https://github.com/openai/openai-node/commit/258d79f52bb31f4f3723f6f4b97ebe8f3fa187bd))
* **ecosystem-tests:** fix flaky tests and remove fine tuning calls ([#625](https://github.com/openai/openai-node/issues/625)) ([58e5fd8](https://github.com/openai/openai-node/commit/58e5fd8f27052be6ac9587256b161f4bf3a3805f))

## 4.24.5 (2024-01-12)

Full Changelog: [v4.24.4...v4.24.5](https://github.com/openai/openai-node/compare/v4.24.4...v4.24.5)

### Refactors

* **api:** remove deprecated endpoints ([#621](https://github.com/openai/openai-node/issues/621)) ([2054d71](https://github.com/openai/openai-node/commit/2054d71e6b0d407229a4c5aecd75e38c336c2c02))

## 4.24.4 (2024-01-11)

Full Changelog: [v4.24.3...v4.24.4](https://github.com/openai/openai-node/compare/v4.24.3...v4.24.4)

### Chores

* **internal:** narrow type into stringifyQuery ([#619](https://github.com/openai/openai-node/issues/619)) ([88fb9cd](https://github.com/openai/openai-node/commit/88fb9cd1bb415850b0b4868944617282d0b92e2a))

## 4.24.3 (2024-01-10)

Full Changelog: [v4.24.2...v4.24.3](https://github.com/openai/openai-node/compare/v4.24.2...v4.24.3)

### Bug Fixes

* use default base url if BASE_URL env var is blank ([#615](https://github.com/openai/openai-node/issues/615)) ([a27ad3d](https://github.com/openai/openai-node/commit/a27ad3d4e06f2202daa169668d0e7d89e87a38a7))

## 4.24.2 (2024-01-08)

Full Changelog: [v4.24.1...v4.24.2](https://github.com/openai/openai-node/compare/v4.24.1...v4.24.2)

### Bug Fixes

* **headers:** always send lowercase headers and strip undefined (BREAKING in rare cases) ([#608](https://github.com/openai/openai-node/issues/608)) ([4ea159f](https://github.com/openai/openai-node/commit/4ea159f0aa9a1f4c365c74ee726714fe692ddf9f))


### Chores

* add .keep files for examples and custom code directories ([#612](https://github.com/openai/openai-node/issues/612)) ([5e0f733](https://github.com/openai/openai-node/commit/5e0f733d3cd3c8e6d41659141168cd0708e017a3))
* **internal:** bump license ([#605](https://github.com/openai/openai-node/issues/605)) ([045ee74](https://github.com/openai/openai-node/commit/045ee74fd3ffba9e6d1301fe1ffd8bd3c63720a2))
* **internal:** improve type signatures ([#609](https://github.com/openai/openai-node/issues/609)) ([e1ccc82](https://github.com/openai/openai-node/commit/e1ccc82e4991262a631dcffa4d09bdc553e50fbb))


### Documentation

* fix docstring typos ([#600](https://github.com/openai/openai-node/issues/600)) ([1934fa1](https://github.com/openai/openai-node/commit/1934fa15f654ea89e226457f76febe6015616f6c))
* improve audio example to show how to stream to a file ([#598](https://github.com/openai/openai-node/issues/598)) ([e950ad9](https://github.com/openai/openai-node/commit/e950ad969e845d608ed71bd3e3095cd6c941d93d))

## 4.24.1 (2023-12-22)

Full Changelog: [v4.24.0...v4.24.1](https://github.com/openai/openai-node/compare/v4.24.0...v4.24.1)

### Bug Fixes

* **pagination:** correct type annotation object field ([#590](https://github.com/openai/openai-node/issues/590)) ([4066eda](https://github.com/openai/openai-node/commit/4066edad4b5305e82e610f44f4720843f2b69d39))


### Documentation

* **messages:** improvements to helpers reference + typos ([#595](https://github.com/openai/openai-node/issues/595)) ([96a59b9](https://github.com/openai/openai-node/commit/96a59b91c424db67b8a5bdb7cab5da68c57282d4))
* reformat README.md ([#592](https://github.com/openai/openai-node/issues/592)) ([8ffc7f8](https://github.com/openai/openai-node/commit/8ffc7f876cc8f4b7afaf68a37f94f826ef22a6b8))


### Refactors

* write jest config in typescript ([#588](https://github.com/openai/openai-node/issues/588)) ([eb6ceeb](https://github.com/openai/openai-node/commit/eb6ceebf90ba45ec5b803f32b9b080829f6a973a))

## 4.24.0 (2023-12-19)

Full Changelog: [v4.23.0...v4.24.0](https://github.com/openai/openai-node/compare/v4.23.0...v4.24.0)

### Features

* **api:** add additional instructions for runs ([#586](https://github.com/openai/openai-node/issues/586)) ([401d93e](https://github.com/openai/openai-node/commit/401d93ea39fe0e90088799858299322035c0a7e8))


### Chores

* **deps:** update dependency start-server-and-test to v2.0.3 ([#580](https://github.com/openai/openai-node/issues/580)) ([8e1aca1](https://github.com/openai/openai-node/commit/8e1aca1f8be6e583483919ed9ef9b04fab076066))
* **deps:** update dependency ts-jest to v29.1.1 ([#578](https://github.com/openai/openai-node/issues/578)) ([a6edb7b](https://github.com/openai/openai-node/commit/a6edb7bc3cfc447d0c55ae23cc1c2219105d3666))
* **deps:** update jest ([#582](https://github.com/openai/openai-node/issues/582)) ([e49e471](https://github.com/openai/openai-node/commit/e49e471ec7a136f2cbaf82551ccaaea366c87a91))
* **internal:** bump deps ([#583](https://github.com/openai/openai-node/issues/583)) ([2e07b4c](https://github.com/openai/openai-node/commit/2e07b4c66ab1fdbb353fdd00994e293f93e981db))
* **internal:** update deps ([#581](https://github.com/openai/openai-node/issues/581)) ([7b690dc](https://github.com/openai/openai-node/commit/7b690dca67ee8c3b0a89caf7f786ede5dc612a76))


### Documentation

* upgrade models in examples to latest version ([#585](https://github.com/openai/openai-node/issues/585)) ([60101a4](https://github.com/openai/openai-node/commit/60101a4117b1a8223d09fb9fe21d89af32431939))

## 4.23.0 (2023-12-17)

Full Changelog: [v4.22.1...v4.23.0](https://github.com/openai/openai-node/compare/v4.22.1...v4.23.0)

### Features

* **api:** add token logprobs to chat completions ([#576](https://github.com/openai/openai-node/issues/576)) ([8d4292e](https://github.com/openai/openai-node/commit/8d4292e6358920b2c9d8df49c6a154231c468512))


### Chores

* **ci:** run release workflow once per day ([#574](https://github.com/openai/openai-node/issues/574)) ([529f09f](https://github.com/openai/openai-node/commit/529f09f827a675d6e851590acff4e6f4f2af2d26))

## 4.22.1 (2023-12-15)

Full Changelog: [v4.22.0...v4.22.1](https://github.com/openai/openai-node/compare/v4.22.0...v4.22.1)

### Chores

* update dependencies ([#572](https://github.com/openai/openai-node/issues/572)) ([a51e620](https://github.com/openai/openai-node/commit/a51e62065224a516b17dd850ae564f5436d8db52))


### Documentation

* replace runFunctions with runTools in readme ([#570](https://github.com/openai/openai-node/issues/570)) ([c3b9ad5](https://github.com/openai/openai-node/commit/c3b9ad58e5f74d3339889aeb1d758c8c18f54de7))

## 4.22.0 (2023-12-15)

Full Changelog: [v4.21.0...v4.22.0](https://github.com/openai/openai-node/compare/v4.21.0...v4.22.0)

### Features

* **api:** add optional `name` argument + improve docs ([#569](https://github.com/openai/openai-node/issues/569)) ([3b68ace](https://github.com/openai/openai-node/commit/3b68ace533976aedbf642d9b018d0de8d9a8bb88))


### Chores

* update prettier ([#567](https://github.com/openai/openai-node/issues/567)) ([83dec2a](https://github.com/openai/openai-node/commit/83dec2af62c481d7de16d8a3644aa239ded9e30c))

## 4.21.0 (2023-12-11)

Full Changelog: [v4.20.1...v4.21.0](https://github.com/openai/openai-node/compare/v4.20.1...v4.21.0)

### Features

* **client:** support reading the base url from an env variable ([#547](https://github.com/openai/openai-node/issues/547)) ([06fb68d](https://github.com/openai/openai-node/commit/06fb68de1ff80983e349b6715d1037e2072c8dd4))


### Bug Fixes

* correct some runTools behavior and deprecate runFunctions ([#562](https://github.com/openai/openai-node/issues/562)) ([f5cdd0f](https://github.com/openai/openai-node/commit/f5cdd0f704d3d075cdfc5bc2df1f7a8bae5cd9f1))
* prevent 400 when using runTools/runFunctions with Azure OpenAI API ([#544](https://github.com/openai/openai-node/issues/544)) ([735d9b8](https://github.com/openai/openai-node/commit/735d9b86acdc067e1ee6ebe1ea50de2955431050))


### Documentation

* **readme:** update example snippets ([#546](https://github.com/openai/openai-node/issues/546)) ([566d290](https://github.com/openai/openai-node/commit/566d290006920f536788bb77f4d24a6906e2971f))


### Build System

* specify `packageManager: yarn` ([#561](https://github.com/openai/openai-node/issues/561)) ([935b898](https://github.com/openai/openai-node/commit/935b8983c74f7b03b67d22f4d194989838f963f3))

## 4.20.1 (2023-11-24)

Full Changelog: [v4.20.0...v4.20.1](https://github.com/openai/openai-node/compare/v4.20.0...v4.20.1)

### Chores

* **internal:** remove file import and conditionally run prepare ([#533](https://github.com/openai/openai-node/issues/533)) ([48cb729](https://github.com/openai/openai-node/commit/48cb729bfc484ce3d04273be417b307a0d20644f))


### Documentation

* **readme:** fix typo and add examples link ([#529](https://github.com/openai/openai-node/issues/529)) ([cf959b1](https://github.com/openai/openai-node/commit/cf959b17db0a4f8dd7eb59add333c4a461b02459))

## 4.20.0 (2023-11-22)

Full Changelog: [v4.19.1...v4.20.0](https://github.com/openai/openai-node/compare/v4.19.1...v4.20.0)

### Features

* allow installing package directly from github ([#522](https://github.com/openai/openai-node/issues/522)) ([51926d7](https://github.com/openai/openai-node/commit/51926d7a0092744e49de39f4988feddf313adafa))


### Chores

* **internal:** don't call prepare in dist ([#525](https://github.com/openai/openai-node/issues/525)) ([d09411e](https://github.com/openai/openai-node/commit/d09411ebaa28d6610e1b880d03339d520b4a1833))

## 4.19.1 (2023-11-20)

Full Changelog: [v4.19.0...v4.19.1](https://github.com/openai/openai-node/compare/v4.19.0...v4.19.1)

## 4.19.0 (2023-11-15)

Full Changelog: [v4.18.0...v4.19.0](https://github.com/openai/openai-node/compare/v4.18.0...v4.19.0)

### Features

* **api:** updates ([#501](https://github.com/openai/openai-node/issues/501)) ([944d58e](https://github.com/openai/openai-node/commit/944d58e5fc46f1a0671aaa2b809d28e67edf6023))

## 4.18.0 (2023-11-14)

Full Changelog: [v4.17.5...v4.18.0](https://github.com/openai/openai-node/compare/v4.17.5...v4.18.0)

### Features

* **api:** add gpt-3.5-turbo-1106 ([#496](https://github.com/openai/openai-node/issues/496)) ([45f7672](https://github.com/openai/openai-node/commit/45f7672ccf4856ac309b08c6c96f0e73ab48b525))

## 4.17.5 (2023-11-13)

Full Changelog: [v4.17.4...v4.17.5](https://github.com/openai/openai-node/compare/v4.17.4...v4.17.5)

### Chores

* fix typo in docs and add request header for function calls ([#494](https://github.com/openai/openai-node/issues/494)) ([22ce244](https://github.com/openai/openai-node/commit/22ce2443a77f10988b3215bd81ba17d4eda4b10e))

## 4.17.4 (2023-11-10)

Full Changelog: [v4.17.3...v4.17.4](https://github.com/openai/openai-node/compare/v4.17.3...v4.17.4)

### Chores

* **internal:** update jest config ([#482](https://github.com/openai/openai-node/issues/482)) ([3013e8c](https://github.com/openai/openai-node/commit/3013e8c73a61a397a418ca75b996f0a7dd03a744))

## 4.17.3 (2023-11-09)

Full Changelog: [v4.17.2...v4.17.3](https://github.com/openai/openai-node/compare/v4.17.2...v4.17.3)

## 4.17.2 (2023-11-09)

Full Changelog: [v4.17.1...v4.17.2](https://github.com/openai/openai-node/compare/v4.17.1...v4.17.2)

### Chores

* **internal:** bump deno version number ([#478](https://github.com/openai/openai-node/issues/478)) ([69913f3](https://github.com/openai/openai-node/commit/69913f3a4b0123394029759375445dae7b4f15ab))

## 4.17.1 (2023-11-09)

Full Changelog: [v4.17.0...v4.17.1](https://github.com/openai/openai-node/compare/v4.17.0...v4.17.1)

### Refactors

* **client:** deprecate files.retrieveContent in favour of files.content ([#474](https://github.com/openai/openai-node/issues/474)) ([7c7bfc2](https://github.com/openai/openai-node/commit/7c7bfc2fad5a786c9172110e90c9566a943e49f9))

## 4.17.0 (2023-11-08)

Full Changelog: [v4.16.2...v4.17.0](https://github.com/openai/openai-node/compare/v4.16.2...v4.17.0)

### Features

* **api:** unify function types ([#467](https://github.com/openai/openai-node/issues/467)) ([d51cd94](https://github.com/openai/openai-node/commit/d51cd94b3103219789447e2e9afc4762ae672e5a))


### Refactors

* **api:** rename FunctionObject to FunctionDefinition ([#470](https://github.com/openai/openai-node/issues/470)) ([f3990c7](https://github.com/openai/openai-node/commit/f3990c779e596309b62f41d7a1253d8629aca3bf))

## 4.16.2 (2023-11-08)

Full Changelog: [v4.16.1...v4.16.2](https://github.com/openai/openai-node/compare/v4.16.1...v4.16.2)

### Bug Fixes

* **api:** accidentally required params, add new models & other fixes ([#463](https://github.com/openai/openai-node/issues/463)) ([1cb403e](https://github.com/openai/openai-node/commit/1cb403e4ccde61bb1613d362f6bdbca8b1681e00))
* **api:** update embedding response object type ([#466](https://github.com/openai/openai-node/issues/466)) ([53b7e25](https://github.com/openai/openai-node/commit/53b7e2539cca0b272be96136c123d2b33745e7f6))
* asssitant_deleted -&gt; assistant_deleted ([#452](https://github.com/openai/openai-node/issues/452)) ([ef89bd7](https://github.com/openai/openai-node/commit/ef89bd74d85c833bf7de500eecd1b092a0ad3f37))
* **types:** ensure all code paths return a value ([#458](https://github.com/openai/openai-node/issues/458)) ([19402c3](https://github.com/openai/openai-node/commit/19402c365572a99cbee58bcd34a9942e741269bf))


### Chores

* **docs:** fix github links ([#457](https://github.com/openai/openai-node/issues/457)) ([6b9b94e](https://github.com/openai/openai-node/commit/6b9b94e4e123349a908b708cd574ff107f40a8e1))
* **internal:** fix typo in comment ([#456](https://github.com/openai/openai-node/issues/456)) ([fe24342](https://github.com/openai/openai-node/commit/fe2434284a91d424510873a18079b8870469c672))


### Documentation

* update deno deploy link to include v ([#441](https://github.com/openai/openai-node/issues/441)) ([47b13aa](https://github.com/openai/openai-node/commit/47b13aaa6fac86fffabee1f752ee6d2efc3def9b))

## 4.16.1 (2023-11-06)

Full Changelog: [v4.16.0...v4.16.1](https://github.com/openai/openai-node/compare/v4.16.0...v4.16.1)

### Bug Fixes

* **api:** retreival -&gt; retrieval ([#437](https://github.com/openai/openai-node/issues/437)) ([b4bd3ee](https://github.com/openai/openai-node/commit/b4bd3eefdd3903abcc57c431382cc2124d39307b))


### Documentation

* **api:** improve docstrings ([#435](https://github.com/openai/openai-node/issues/435)) ([ee8b24c](https://github.com/openai/openai-node/commit/ee8b24c70a5ccb944e02ff2201668d6bc2b597b3))

## 4.16.0 (2023-11-06)

Full Changelog: [v4.15.4...v4.16.0](https://github.com/openai/openai-node/compare/v4.15.4...v4.16.0)

### Features

* **api:** releases from DevDay; assistants, multimodality, tools, dall-e-3, tts, and more ([#433](https://github.com/openai/openai-node/issues/433)) ([fb92f5e](https://github.com/openai/openai-node/commit/fb92f5e6e3b6e7969b3d91f4ccdaef87e5fea0a4))


### Bug Fixes

* improve deno readme ([#429](https://github.com/openai/openai-node/issues/429)) ([871ceac](https://github.com/openai/openai-node/commit/871ceac2b37f53f7fc7c0163454115c709cd7ced))


### Documentation

* deno version ([#432](https://github.com/openai/openai-node/issues/432)) ([74bf336](https://github.com/openai/openai-node/commit/74bf3364379fd23252fde01401c44b2fa796cba4))
* update deno link in more places ([#431](https://github.com/openai/openai-node/issues/431)) ([5da63d4](https://github.com/openai/openai-node/commit/5da63d4a9143c0ab493b742f7fde22b01a372844))

## 4.15.4 (2023-11-05)

Full Changelog: [v4.15.3...v4.15.4](https://github.com/openai/openai-node/compare/v4.15.3...v4.15.4)

### Documentation

* **readme:** remove redundant whitespace ([#427](https://github.com/openai/openai-node/issues/427)) ([aa3a178](https://github.com/openai/openai-node/commit/aa3a1782914a4a285263e4d070bca73e72ed47ec))

## 4.15.3 (2023-11-04)

Full Changelog: [v4.15.2...v4.15.3](https://github.com/openai/openai-node/compare/v4.15.2...v4.15.3)

### Bug Fixes

* improve deno releases ([#425](https://github.com/openai/openai-node/issues/425)) ([19469f2](https://github.com/openai/openai-node/commit/19469f266ff69a4e549402188d9f6ad87f5a7778))

## 4.15.2 (2023-11-04)

Full Changelog: [v4.15.1...v4.15.2](https://github.com/openai/openai-node/compare/v4.15.1...v4.15.2)

### Documentation

* fix deno.land import ([#423](https://github.com/openai/openai-node/issues/423)) ([e5415a2](https://github.com/openai/openai-node/commit/e5415a29ab447ced8535fafda7928b0a6748c8d1))

## 4.15.1 (2023-11-04)

Full Changelog: [v4.15.0...v4.15.1](https://github.com/openai/openai-node/compare/v4.15.0...v4.15.1)

### Documentation

* document customizing fetch ([#420](https://github.com/openai/openai-node/issues/420)) ([1ca982f](https://github.com/openai/openai-node/commit/1ca982f192daf49e33b7acb5505ed26c9d891255))

## 4.15.0 (2023-11-03)

Full Changelog: [v4.14.2...v4.15.0](https://github.com/openai/openai-node/compare/v4.14.2...v4.15.0)

### Features

* **beta:** add streaming and function calling helpers ([#409](https://github.com/openai/openai-node/issues/409)) ([510c1f3](https://github.com/openai/openai-node/commit/510c1f325ee55197b4c2f434475128c265500746))
* **client:** allow binary returns ([#416](https://github.com/openai/openai-node/issues/416)) ([02f7ad7](https://github.com/openai/openai-node/commit/02f7ad7f736751e0e7687e6744bae464d4e40b79))
* **github:** include a devcontainer setup ([#413](https://github.com/openai/openai-node/issues/413)) ([fb2996f](https://github.com/openai/openai-node/commit/fb2996f0d291210878145aacf9b952f8133d9414))
* streaming improvements ([#411](https://github.com/openai/openai-node/issues/411)) ([37b622c](https://github.com/openai/openai-node/commit/37b622c79ddbd6c286b730e740403c82b542e796))

## 4.14.2 (2023-10-30)

Full Changelog: [v4.14.1...v4.14.2](https://github.com/openai/openai-node/compare/v4.14.1...v4.14.2)

### Chores

* **docs:** update deno link ([#407](https://github.com/openai/openai-node/issues/407)) ([0328882](https://github.com/openai/openai-node/commit/0328882cccb3e5386283ffa5eb9cd8ad9442f3a0))

## 4.14.1 (2023-10-27)

Full Changelog: [v4.14.0...v4.14.1](https://github.com/openai/openai-node/compare/v4.14.0...v4.14.1)

### Bug Fixes

* deploy deno in a github workflow instead of postpublish step ([#405](https://github.com/openai/openai-node/issues/405)) ([3a6dba0](https://github.com/openai/openai-node/commit/3a6dba074258274bffcfe3a4260ca1b95bcd6bdc))
* typo in build script ([#403](https://github.com/openai/openai-node/issues/403)) ([76c5c96](https://github.com/openai/openai-node/commit/76c5c96a359f750f58ea38b5d32365db7e34409a))


### Chores

* **internal:** update gitignore ([#406](https://github.com/openai/openai-node/issues/406)) ([986b0bb](https://github.com/openai/openai-node/commit/986b0bbac9f5ca43a0df6f29f2a468dd4223e053))

## 4.14.0 (2023-10-25)

Full Changelog: [v4.13.0...v4.14.0](https://github.com/openai/openai-node/compare/v4.13.0...v4.14.0)

### Features

* **client:** adjust retry behavior to be exponential backoff ([#400](https://github.com/openai/openai-node/issues/400)) ([2bc14ce](https://github.com/openai/openai-node/commit/2bc14ce300ef020bc045199fe3d76dd352d78ef9))


### Chores

* **docs:** update deno version ([#399](https://github.com/openai/openai-node/issues/399)) ([cdee077](https://github.com/openai/openai-node/commit/cdee0770690d4b66b357d970827e9ba1597ffb89))

## 4.13.0 (2023-10-22)

Full Changelog: [v4.12.4...v4.13.0](https://github.com/openai/openai-node/compare/v4.12.4...v4.13.0)

### Features

* **api:** add embeddings encoding_format ([#390](https://github.com/openai/openai-node/issues/390)) ([cf70dea](https://github.com/openai/openai-node/commit/cf70deaba1426786aba9b938d280c61aeb516e34))
* handle 204 No Content gracefully ([#391](https://github.com/openai/openai-node/issues/391)) ([2dd005c](https://github.com/openai/openai-node/commit/2dd005c1c497605036d3524f19d130b3fc5f8d8b))

## 4.12.4 (2023-10-17)

Full Changelog: [v4.12.3...v4.12.4](https://github.com/openai/openai-node/compare/v4.12.3...v4.12.4)

### Bug Fixes

* import web-streams-polyfill without overriding globals ([#385](https://github.com/openai/openai-node/issues/385)) ([be8e18b](https://github.com/openai/openai-node/commit/be8e18ba4c6a16e7b6413c77246f83230e0b8fc2))

## 4.12.3 (2023-10-16)

Full Changelog: [v4.12.2...v4.12.3](https://github.com/openai/openai-node/compare/v4.12.2...v4.12.3)

### Documentation

* organisation -&gt; organization (UK to US English) ([#382](https://github.com/openai/openai-node/issues/382)) ([516f0ad](https://github.com/openai/openai-node/commit/516f0ade1ec1fd8fc4c78999ee0f656cc2b5ae58))

## 4.12.2 (2023-10-16)

Full Changelog: [v4.12.1...v4.12.2](https://github.com/openai/openai-node/compare/v4.12.1...v4.12.2)

### Bug Fixes

* **client:** correctly handle errors during streaming ([#377](https://github.com/openai/openai-node/issues/377)) ([09233b1](https://github.com/openai/openai-node/commit/09233b1ccc80ee900be19050f438cc8aa9dbb513))
* **client:** correctly handle errors during streaming ([#379](https://github.com/openai/openai-node/issues/379)) ([9ced580](https://github.com/openai/openai-node/commit/9ced5804777a5857d6775a49ddf30ed9cc016fab))
* improve status code in error messages ([#381](https://github.com/openai/openai-node/issues/381)) ([68dfb17](https://github.com/openai/openai-node/commit/68dfb17cce300ade8d29afc854d616833b3283ca))


### Chores

* add case insensitive get header function ([#373](https://github.com/openai/openai-node/issues/373)) ([b088998](https://github.com/openai/openai-node/commit/b088998ae610de54bb8700eefd6b664eb9a2fcc3))
* **internal:** add debug logs for stream responses ([#380](https://github.com/openai/openai-node/issues/380)) ([689db0b](https://github.com/openai/openai-node/commit/689db0b8058527ae5c3af5e457c962d8a6635297))
* show deprecation notice on re-export ([#368](https://github.com/openai/openai-node/issues/368)) ([b176703](https://github.com/openai/openai-node/commit/b176703102998f0e9d8ca2ed93ccd495fd10a6ee))
* update comment ([#376](https://github.com/openai/openai-node/issues/376)) ([a06c685](https://github.com/openai/openai-node/commit/a06c6850bfdd756dc8f07dd1f70218be610faa30))
* update comment ([#378](https://github.com/openai/openai-node/issues/378)) ([b04031d](https://github.com/openai/openai-node/commit/b04031d19210a66f82c7d233a50f7bc427a1bf92))


### Refactors

* **streaming:** change Stream constructor signature ([#370](https://github.com/openai/openai-node/issues/370)) ([71984ed](https://github.com/openai/openai-node/commit/71984edc3141ba99ffa1327bab6a182b4452209f))
* **test:** refactor authentication tests ([#371](https://github.com/openai/openai-node/issues/371)) ([e0d459f](https://github.com/openai/openai-node/commit/e0d459f958451a99e15a11a0e5ea6471abbe1ac1))

## 4.12.1 (2023-10-11)

Full Changelog: [v4.12.0...v4.12.1](https://github.com/openai/openai-node/compare/v4.12.0...v4.12.1)

### Bug Fixes

* fix namespace exports regression ([#366](https://github.com/openai/openai-node/issues/366)) ([b2b1d85](https://github.com/openai/openai-node/commit/b2b1d85d90eef51e689ca75c0ca2f35bb63cccc0))

## 4.12.0 (2023-10-11)

Full Changelog: [v4.11.1...v4.12.0](https://github.com/openai/openai-node/compare/v4.11.1...v4.12.0)

### Features

* **api:** remove `content_filter` stop_reason and update documentation ([#352](https://github.com/openai/openai-node/issues/352)) ([a4b401e](https://github.com/openai/openai-node/commit/a4b401e91a0b3fbf55aedfb6ed6d93396377bf27))
* re-export chat completion types at the top level, and work around webpack limitations ([#365](https://github.com/openai/openai-node/issues/365)) ([bb815d0](https://github.com/openai/openai-node/commit/bb815d0373ae33f58329e34e8983f5b3881db22d))


### Bug Fixes

* prevent ReferenceError, update compatibility to ES2020 and Node 18+ ([#356](https://github.com/openai/openai-node/issues/356)) ([fc71a4b](https://github.com/openai/openai-node/commit/fc71a4b6b73208ff3e8f0c8792a9a03e3790d26b))


### Chores

* **internal:** minor formatting improvement ([#354](https://github.com/openai/openai-node/issues/354)) ([3799863](https://github.com/openai/openai-node/commit/3799863da4ff2a27940ef0b7e57360c72e44d986))

## 4.11.1 (2023-10-03)

Full Changelog: [v4.11.0...v4.11.1](https://github.com/openai/openai-node/compare/v4.11.0...v4.11.1)

## 4.11.0 (2023-09-29)

Full Changelog: [v4.10.0...v4.11.0](https://github.com/openai/openai-node/compare/v4.10.0...v4.11.0)

### Features

* **client:** handle retry-after with a date ([#340](https://github.com/openai/openai-node/issues/340)) ([b6dd384](https://github.com/openai/openai-node/commit/b6dd38488ea7cc4c22495f16d027b7ffdb87da53))
* **package:** export a root error type ([#338](https://github.com/openai/openai-node/issues/338)) ([462bcda](https://github.com/openai/openai-node/commit/462bcda7140611afa20bc25de4aec6d4b205b37d))


### Bug Fixes

* **api:** add content_filter to chat completion finish reason ([#344](https://github.com/openai/openai-node/issues/344)) ([f10c757](https://github.com/openai/openai-node/commit/f10c757d831d90407ba47b4659d9cd34b1a35b1d))


### Chores

* **internal:** bump lock file ([#334](https://github.com/openai/openai-node/issues/334)) ([fd2337b](https://github.com/openai/openai-node/commit/fd2337b018ab2f31bcea8f9feda0ddaf755390c7))
* **internal:** update lock file ([#339](https://github.com/openai/openai-node/issues/339)) ([1bf84b6](https://github.com/openai/openai-node/commit/1bf84b672c386f8ca46bb8fc120eb8d8d48b3a82))
* **internal:** update lock file ([#342](https://github.com/openai/openai-node/issues/342)) ([0001f06](https://github.com/openai/openai-node/commit/0001f062728b0e2047d2bf03b9d947a4be0c7206))
* **internal:** update lock file ([#343](https://github.com/openai/openai-node/issues/343)) ([a02ac8e](https://github.com/openai/openai-node/commit/a02ac8e7f881551527a3cbcadad53b7e424650e8))

## 4.10.0 (2023-09-21)

Full Changelog: [v4.9.1...v4.10.0](https://github.com/openai/openai-node/compare/v4.9.1...v4.10.0)

### Features

* **api:** add 'gpt-3.5-turbo-instruct', fine-tune error objects, update documentation ([#329](https://github.com/openai/openai-node/issues/329)) ([e5f3852](https://github.com/openai/openai-node/commit/e5f385233737002b4bb47a94cba33da7fedfe64d))

## 4.10.0 (2023-09-21)

Full Changelog: [v4.9.1...v4.10.0](https://github.com/openai/openai-node/compare/v4.9.1...v4.10.0)

### Features

* **api:** add 'gpt-3.5-turbo-instruct', fine-tune error objects, update documentation ([#329](https://github.com/openai/openai-node/issues/329)) ([e5f3852](https://github.com/openai/openai-node/commit/e5f385233737002b4bb47a94cba33da7fedfe64d))

## 4.9.1 (2023-09-21)

Full Changelog: [v4.9.0...v4.9.1](https://github.com/openai/openai-node/compare/v4.9.0...v4.9.1)

### Documentation

* **README:** fix variable names in some examples ([#327](https://github.com/openai/openai-node/issues/327)) ([5e05b31](https://github.com/openai/openai-node/commit/5e05b31c132545ce166cea92c5f3e4410fd40711))

## 4.9.0 (2023-09-20)

Full Changelog: [v4.8.0...v4.9.0](https://github.com/openai/openai-node/compare/v4.8.0...v4.9.0)

### Features

* **client:** support importing node or web shims manually ([#325](https://github.com/openai/openai-node/issues/325)) ([628f293](https://github.com/openai/openai-node/commit/628f2935a8791625685f68f73db8f3759b8f4f91))

## 4.8.0 (2023-09-15)

Full Changelog: [v4.7.1...v4.8.0](https://github.com/openai/openai-node/compare/v4.7.1...v4.8.0)

### Features

* **errors:** add status code to error message ([#315](https://github.com/openai/openai-node/issues/315)) ([9341219](https://github.com/openai/openai-node/commit/93412197c67cb3fb203f35e3ae0a7c3fb173453e))

## 4.7.1 (2023-09-15)

Full Changelog: [v4.7.0...v4.7.1](https://github.com/openai/openai-node/compare/v4.7.0...v4.7.1)

### Documentation

* declare Bun 1.0 officially supported ([#314](https://github.com/openai/openai-node/issues/314)) ([a16e268](https://github.com/openai/openai-node/commit/a16e26863390235cb43e2fe0e569298a4f84c32f))

## 4.7.0 (2023-09-14)

Full Changelog: [v4.6.0...v4.7.0](https://github.com/openai/openai-node/compare/v4.6.0...v4.7.0)

### Features

* **client:** retry on 408 Request Timeout ([#310](https://github.com/openai/openai-node/issues/310)) ([1f98eac](https://github.com/openai/openai-node/commit/1f98eac5be956e56d75ef5456115165b45a4763c))
* make docs urls in comments absolute ([#306](https://github.com/openai/openai-node/issues/306)) ([9db3819](https://github.com/openai/openai-node/commit/9db381961e38d2280b0602447e7d91691b327bde))

## 4.6.0 (2023-09-08)

Full Changelog: [v4.5.0...v4.6.0](https://github.com/openai/openai-node/compare/v4.5.0...v4.6.0)

### Features

* **types:** extract ChatCompletionRole enum to its own type ([#298](https://github.com/openai/openai-node/issues/298)) ([5893e37](https://github.com/openai/openai-node/commit/5893e37406ff85331c85a3baa519ca3051a28e00))


### Bug Fixes

* fix module not found errors in Vercel edge ([#300](https://github.com/openai/openai-node/issues/300)) ([47c79fe](https://github.com/openai/openai-node/commit/47c79fee0fa715ad04410e73530829602736d85f))

## 4.5.0 (2023-09-06)

Full Changelog: [v4.4.0...v4.5.0](https://github.com/openai/openai-node/compare/v4.4.0...v4.5.0)

### Features

* **client:** add files.waitForProcessing() method ([#292](https://github.com/openai/openai-node/issues/292)) ([ef59010](https://github.com/openai/openai-node/commit/ef59010cab0c666fa8a437ec6e27800789aa8705))
* fixes tests where an array has to have unique enum values ([#290](https://github.com/openai/openai-node/issues/290)) ([a10b895](https://github.com/openai/openai-node/commit/a10b8956b3eaae7cdcb90329a8386a41219ca021))
* make docs more readable by eliminating unnecessary escape sequences ([#287](https://github.com/openai/openai-node/issues/287)) ([a068043](https://github.com/openai/openai-node/commit/a06804314d4815d420c97f6f965c926ea70d56df))


### Bug Fixes

* **client:** fix TS errors that appear when users Go to Source in VSCode ([#281](https://github.com/openai/openai-node/issues/281)) ([8dc59bc](https://github.com/openai/openai-node/commit/8dc59bcf924cc991747ca475c714d915e04c6012)), closes [#249](https://github.com/openai/openai-node/issues/249)
* **client:** handle case where the client is instantiated with a undefined baseURL ([#285](https://github.com/openai/openai-node/issues/285)) ([5095cf3](https://github.com/openai/openai-node/commit/5095cf340743e4627b4f0ad2f055ebe332824d23))
* **client:** use explicit file extensions in _shims imports ([#276](https://github.com/openai/openai-node/issues/276)) ([16fe929](https://github.com/openai/openai-node/commit/16fe929688d35c2ebe52c8cf1c1570bafda5f97e))


### Documentation

* **api:** update docstrings ([#286](https://github.com/openai/openai-node/issues/286)) ([664e953](https://github.com/openai/openai-node/commit/664e9532c8acfbf981e9a788ab40c111ebe2fda0))
* **readme:** add link to api.md ([#291](https://github.com/openai/openai-node/issues/291)) ([0d1cce2](https://github.com/openai/openai-node/commit/0d1cce26cdc6567c10c8d72bbc72a788ffb8f2be))

## 4.4.0 (2023-09-01)

Full Changelog: [v4.3.1...v4.4.0](https://github.com/openai/openai-node/compare/v4.3.1...v4.4.0)

### Features

* **package:** add Bun export map ([#269](https://github.com/openai/openai-node/issues/269)) ([16f239c](https://github.com/openai/openai-node/commit/16f239c6b4e8526371b01c511d2e0ebba4c5c8c6))
* re-export chat completion types at the top level ([#268](https://github.com/openai/openai-node/issues/268)) ([1a71a39](https://github.com/openai/openai-node/commit/1a71a39421828fdde7b8605094363a5047d2fdc9))
* **tests:** unskip multipart form data tests ([#275](https://github.com/openai/openai-node/issues/275)) ([47d3e18](https://github.com/openai/openai-node/commit/47d3e18a3ee987d04b958dad1a51821ad5472d54))
* **types:** fix ambiguous auto-import for chat completions params ([#266](https://github.com/openai/openai-node/issues/266)) ([19c99fb](https://github.com/openai/openai-node/commit/19c99fb268d6d6c7fc7aaa66475c35f45d12b4bd))


### Bug Fixes

* revert import change which triggered circular import bug in webpack ([#274](https://github.com/openai/openai-node/issues/274)) ([6534e36](https://github.com/openai/openai-node/commit/6534e3620d7e2983e98b42cf95fa966deab1ab1d))

## 4.3.1 (2023-08-29)

Full Changelog: [v4.3.0...v4.3.1](https://github.com/openai/openai-node/compare/v4.3.0...v4.3.1)

### Bug Fixes

* **types:** improve getNextPage() return type ([#262](https://github.com/openai/openai-node/issues/262)) ([245a984](https://github.com/openai/openai-node/commit/245a9847d1ba5bbe5262bc06b2f7bb7385cd3a9a))


### Chores

* **ci:** setup workflows to create releases and release PRs ([#259](https://github.com/openai/openai-node/issues/259)) ([290908c](https://github.com/openai/openai-node/commit/290908ce24dc6c31df18b2eb7808d5b495387454))

## [4.3.0](https://github.com/openai/openai-node/compare/v4.2.0...v4.3.0) (2023-08-27)


### Features

* **client:** add auto-pagination to fine tuning list endpoints ([#254](https://github.com/openai/openai-node/issues/254)) ([5f89c5e](https://github.com/openai/openai-node/commit/5f89c5e6b9088cc2e86405a32b60cae91c078ce1))
* **cli:** rewrite in JS for better compatibility ([#244](https://github.com/openai/openai-node/issues/244)) ([d8d7c05](https://github.com/openai/openai-node/commit/d8d7c0592bfad89669cd2f174e6207370cd7d3fb))


### Bug Fixes

* **stream:** declare Stream.controller as public ([#252](https://github.com/openai/openai-node/issues/252)) ([81e5de7](https://github.com/openai/openai-node/commit/81e5de7ba94c992cafa3d08e2697c8122382497a))


### Documentation

* **readme:** mention Azure support ([#253](https://github.com/openai/openai-node/issues/253)) ([294727a](https://github.com/openai/openai-node/commit/294727ad3543d91ef59df285ce1616c442d369db))


### Chores

* **internal:** add helper method ([#255](https://github.com/openai/openai-node/issues/255)) ([6d8cff0](https://github.com/openai/openai-node/commit/6d8cff00164c0f65ed40b941486f2e0d752feb1e))

## [4.2.0](https://github.com/openai/openai-node/compare/v4.1.0...v4.2.0) (2023-08-23)


### Features

* **types:** export RequestOptions type ([#240](https://github.com/openai/openai-node/issues/240)) ([ecf3bce](https://github.com/openai/openai-node/commit/ecf3bcee3c64a80a3cd901aa32d3db78d1364645))


### Chores

* **internal:** export HeadersInit type shim ([#241](https://github.com/openai/openai-node/issues/241)) ([cf9f672](https://github.com/openai/openai-node/commit/cf9f6729b5b232a37841c33db33b2519b54f19b2))
