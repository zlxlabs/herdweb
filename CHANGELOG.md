# [1.7.0](https://github.com/zlxlabs/herdweb/compare/v1.6.1...v1.7.0) (2026-08-24)


### Bug Fixes

* **client:** project browser configuration ([d5cd124](https://github.com/zlxlabs/herdweb/commit/d5cd124bd446d1cb60fe6287b777b99e013f974e))
* **server:** bound terminal mirror backlog ([96d7a6e](https://github.com/zlxlabs/herdweb/commit/96d7a6e29dcfb20de754013ec8960cfc695af580))
* **server:** isolate slow websocket clients ([99a02da](https://github.com/zlxlabs/herdweb/commit/99a02da07d42bbc09a92de0174a73ab7d1f6c87e))
* **server:** retain service on exit fact write failure ([6daf048](https://github.com/zlxlabs/herdweb/commit/6daf048e73c6039666e4a833831fc082aa87890c))


### Features

* **cli:** enforce target command modes ([715f77a](https://github.com/zlxlabs/herdweb/commit/715f77a2573708e5e4e1a39a03bcba73b15d1b4c))
* **config:** validate target configuration ([928cd75](https://github.com/zlxlabs/herdweb/commit/928cd75a3cdeb0b6de962921b1cf0428c1175b9d))
* **server:** add lazy target registry ([0eaa802](https://github.com/zlxlabs/herdweb/commit/0eaa802cdbaac8ae8fe0449ef5575b4b14303e44))
* **server:** keep serving after target exit ([a64b0c0](https://github.com/zlxlabs/herdweb/commit/a64b0c076a4f0a83f6c45fba1c9d5efb4f4eea24))
* **target:** add target config contract ([f403ae8](https://github.com/zlxlabs/herdweb/commit/f403ae870ea979ae05a88687f1b77ff6008a31bc))

## [1.6.1](https://github.com/zlxlabs/herdweb/compare/v1.6.0...v1.6.1) (2026-08-23)


### Bug Fixes

* **pwa:** fetch manifest with credentials so install check works behind auth proxies ([0143950](https://github.com/zlxlabs/herdweb/commit/014395029dee083ddb8eefdf73264d20424ec665))

# [1.6.0](https://github.com/zlxlabs/herdweb/compare/v1.5.0...v1.6.0) (2026-08-23)


### Features

* **drawer:** 4-column grid with fixed 480px panel geometry ([33adc74](https://github.com/zlxlabs/herdweb/commit/33adc74dbed7a6405ae3e3b8db6bdc8264240266))

# [1.5.0](https://github.com/zlxlabs/herdweb/compare/v1.4.0...v1.5.0) (2026-08-23)


### Features

* **deploy:** move production to a dedicated XDG clone ([e410c51](https://github.com/zlxlabs/herdweb/commit/e410c5108d6136cc3570d48bffad94a8a57c3d44))

# [1.4.0](https://github.com/zlxlabs/herdweb/compare/v1.3.2...v1.4.0) (2026-08-23)


### Features

* **drawer:** drop d-pad-duplicated keys from default buttons ([61c30ae](https://github.com/zlxlabs/herdweb/commit/61c30ae00038d05770a9203f8138db8d991831c6))

## [1.3.2](https://github.com/zlxlabs/herdweb/compare/v1.3.1...v1.3.2) (2026-08-23)


### Bug Fixes

* **notify:** deduplicate session in channel content ([c76f2e4](https://github.com/zlxlabs/herdweb/commit/c76f2e4a6a62f4c49931b93b000194df9e881075))

## [1.3.1](https://github.com/zlxlabs/herdweb/compare/v1.3.0...v1.3.1) (2026-08-23)


### Bug Fixes

* **config:** gitignore .local config overrides where credentials belong ([6224e01](https://github.com/zlxlabs/herdweb/commit/6224e01ed90ff7f54bb5ae1779b8d5539c33c7fb))

# [1.3.0](https://github.com/zlxlabs/herdweb/compare/v1.2.0...v1.3.0) (2026-08-23)


### Bug Fixes

* **notify:** drop type assertion in channel error formatting ([421990e](https://github.com/zlxlabs/herdweb/commit/421990ec00014dd35d654db4dec887040687f062))


### Features

* **notify:** add outbound notification channels ([d256866](https://github.com/zlxlabs/herdweb/commit/d256866284e5b2d956ceeccb1a8c8601c60ed235))

# [1.2.0](https://github.com/zlxlabs/herdweb/compare/v1.1.0...v1.2.0) (2026-08-23)


### Bug Fixes

* **notify:** allow GET vapid-key/history without Origin and add push/test ([c17e74f](https://github.com/zlxlabs/herdweb/commit/c17e74f8dd1a7b0b172e1daa1d389ac0e8289d96))
* **notify:** bind push toggle to change instead of onTap ([db122fa](https://github.com/zlxlabs/herdweb/commit/db122fa80a97d997f0ce3b4c494a8b1e1a17dbe7))
* **notify:** clear awaitInFlight race loser timer on early settle ([b0cb277](https://github.com/zlxlabs/herdweb/commit/b0cb277dfd75d9b49b68b60e8adc36524459bcd6))
* **notify:** correct VAPID subject default and config override priority ([a41a677](https://github.com/zlxlabs/herdweb/commit/a41a677d1b7798780214ab13917aa00809dfaaff))
* **notify:** cover bare base path with service worker scope ([2b27b8f](https://github.com/zlxlabs/herdweb/commit/2b27b8f1cb2670a5429254242316e6a82e111eb9))
* **notify:** fail-safe panel subscribe and SW resubscribe rollback (F-P2-2–4) ([96a860a](https://github.com/zlxlabs/herdweb/commit/96a860a0bd1d70ee51aa124ef8ea99c4acf8a95c))
* **notify:** log push delivery outcomes and skipped empty targets ([b2b4fc9](https://github.com/zlxlabs/herdweb/commit/b2b4fc923be186482e269fc1cadaae307a1314df))
* **notify:** preserve subscriptions during push delivery ([b8bfc26](https://github.com/zlxlabs/herdweb/commit/b8bfc26577fb66c31698ef5ca22423abcc683969))
* **notify:** route panel test button through /api/push/test ([ca65732](https://github.com/zlxlabs/herdweb/commit/ca6573210fd496ff14d96446b123a6761162c2d1))
* **notify:** simplify atomic write and defer event trim (F-P2-1, F-P2-7) ([cf69963](https://github.com/zlxlabs/herdweb/commit/cf699637ea545e327505140cd6811d1d12b29395))
* **notify:** sink fire-and-forget push rejection (F-P1-1) ([b27a8c5](https://github.com/zlxlabs/herdweb/commit/b27a8c5a65501f701600a03f4eaea8dfb7220cc3))
* **notify:** surface push subscribe failures in panel ([e423afa](https://github.com/zlxlabs/herdweb/commit/e423afa14c65c5c705b6d9c29d9095eb1430a61a))
* **notify:** use getRegistration when serviceWorker.ready hangs on Edge 151 ([745de7d](https://github.com/zlxlabs/herdweb/commit/745de7d8da33b198a981319b2b674537e6833a20))
* **process:** preserve detached exit events ([40bb1a4](https://github.com/zlxlabs/herdweb/commit/40bb1a40bc820171c8f30731ab1e521ccd3f7a64))
* **serve:** dispose terminal session on PTY exit (F-P2-5) ([28434a2](https://github.com/zlxlabs/herdweb/commit/28434a22aa68b86dfb5f2ac9961978419a1d7c1c))
* **test:** terminate isolated serve with its caller ([990fd56](https://github.com/zlxlabs/herdweb/commit/990fd56a22b0daa3f7492b381e5c5bd27cbcc5ac))


### Features

* **notify:** add drawer notification settings panel ([bce447f](https://github.com/zlxlabs/herdweb/commit/bce447fe37e60992ddc25eef7e570291f57fa415))
* **notify:** add event schema and per-port state helpers ([89869c4](https://github.com/zlxlabs/herdweb/commit/89869c4f808257c13c41ad2b2198ea706cb49803))
* **notify:** add events.jsonl history reader with limit clamping ([715de92](https://github.com/zlxlabs/herdweb/commit/715de926d6e135e80ad4a534b956a0fac29ce6d1))
* **notify:** add health lane helpers and last-session store ([b8dfeaa](https://github.com/zlxlabs/herdweb/commit/b8dfeaa2c4e40a11c338dee3cfd75c1ab83bd1e5))
* **notify:** add history inbox list to notification panel ([98b1982](https://github.com/zlxlabs/herdweb/commit/98b19826002f46ac37788ef705986ec9c26dcd09))
* **notify:** add PTY byte accumulator to SharedTerminalSession ([01ae80c](https://github.com/zlxlabs/herdweb/commit/01ae80ca8b78c460e40a6128b2b1bd275a56491e))
* **notify:** add silence detector state machine ([251a3aa](https://github.com/zlxlabs/herdweb/commit/251a3aaf12119bd5f73c89119e97f3c907ce298d))
* **notify:** add Web Push delivery service with VAPID and subscriptions ([5ba8dff](https://github.com/zlxlabs/herdweb/commit/5ba8dffd9d02af234b5b90d55d794bcde86934f2))
* **notify:** bundle service worker and register it from the client ([0607d29](https://github.com/zlxlabs/herdweb/commit/0607d29dc0ed5d7da4b20803b17363a5651e2307))
* **notify:** expose GET /api/events/history for mobile history inbox ([3f6fe06](https://github.com/zlxlabs/herdweb/commit/3f6fe067f7739c5d5e3de0253ac14baf74cfec5b))
* **notify:** mount events/push routes, CSP worker-src, and shutdown drain ([9730a36](https://github.com/zlxlabs/herdweb/commit/9730a3642f7007da78fca8b02cf32c599ddb7a7f))
* **notify:** show permission status line and re-request button in panel ([11dcff4](https://github.com/zlxlabs/herdweb/commit/11dcff45b62265b46de66f28dfaf88daaa45d848))
* **notify:** surface service worker diagnostics ([6f39eee](https://github.com/zlxlabs/herdweb/commit/6f39eee671efb0d81b66f9349d871d9ccd8e218a))
* **notify:** wire silence/health lanes and shutdown drain in serve ([44bda1a](https://github.com/zlxlabs/herdweb/commit/44bda1a664734cf0a2d0915e1d73564d230c050d))
* **process:** support detached process groups ([a867758](https://github.com/zlxlabs/herdweb/commit/a867758752931461174258259c7653ebfc3e955c))

# [1.1.0](https://github.com/zlxlabs/herdweb/compare/v1.0.2...v1.1.0) (2026-08-23)


### Features

* **dpad:** add Tab and Shift+Tab keys ([f4b8398](https://github.com/zlxlabs/herdweb/commit/f4b8398c87796010b6cea46568376ab8da28ce79))
* **drawer:** group buttons into sections with headings ([5798ed8](https://github.com/zlxlabs/herdweb/commit/5798ed83d678d5c609d8d5e29b013101b6b80db2))

## [1.0.2](https://github.com/zlxlabs/herdweb/compare/v1.0.1...v1.0.2) (2026-08-22)


### Bug Fixes

* **viewport:** lift bottom chrome above soft keyboard and debounce terminal resize ([9c8b781](https://github.com/zlxlabs/herdweb/commit/9c8b7812b0779891492914c670b556cb478ca673))

## [1.0.1](https://github.com/zlxlabs/herdweb/compare/v1.0.0...v1.0.1) (2026-08-22)


### Bug Fixes

* **pwa:** pad terminal container by top/side safe-area insets ([96b34e6](https://github.com/zlxlabs/herdweb/commit/96b34e6a7fe455692147607c424924425e5edcc4)), closes [#terminal-container](https://github.com/zlxlabs/herdweb/issues/terminal-container) [#terminal](https://github.com/zlxlabs/herdweb/issues/terminal)
* **test:** narrow matchAll capture so tsc accepts safe-area asserts ([a488ac5](https://github.com/zlxlabs/herdweb/commit/a488ac5d838bc6e12696d0f4aba1c48cca69289f))

# 1.0.0 (2026-08-22)


### Bug Fixes

* add WS relay buffer size limit ([40478fb](https://github.com/zlxlabs/herdweb/commit/40478fb43e596078b2d3e94229db6aaf0533f06f))
* apply origin check to catch-all ttyd proxy ([240d8c3](https://github.com/zlxlabs/herdweb/commit/240d8c371baf97db0b98b0f5669e6ac9e0992595))
* **asr:** accept sequenced partial responses ([c6efb21](https://github.com/zlxlabs/herdweb/commit/c6efb21be25fbf010287cda0d3c8a8a7b1e16a6a))
* **asr:** close engine lifecycle state machine ([33663fa](https://github.com/zlxlabs/herdweb/commit/33663faca76dcac43647a988cfd656cf158762de))
* **asr:** close PTT cancellation and injection races ([6f154bc](https://github.com/zlxlabs/herdweb/commit/6f154bc201abe60b5c8ce8edb7563faedc505ad9))
* **asr:** cover stopping lifecycle rejection paths ([397e3d6](https://github.com/zlxlabs/herdweb/commit/397e3d6664dbb3518e2272a072afc463fe8a898b))
* **asr:** drive mock responses from real fixtures ([2ce57a4](https://github.com/zlxlabs/herdweb/commit/2ce57a41ddba932d1b5545136e2dfea9d6588a98))
* **asr:** expose final response sequence ([f0b82b9](https://github.com/zlxlabs/herdweb/commit/f0b82b9de58d11747541e82c84d6ca99dbaac856))
* **asr:** fail closed opened startup sockets ([7ef713d](https://github.com/zlxlabs/herdweb/commit/7ef713d8d0dcc05c4c46b983a5c42863b56bc89b))
* **asr:** fail loudly on worklet errors ([c8f9b3f](https://github.com/zlxlabs/herdweb/commit/c8f9b3fde4ee030788a3d7d767fd2c3e167016c0))
* **asr:** format engine adapters ([48ac45c](https://github.com/zlxlabs/herdweb/commit/48ac45c2326939766273943f7838083857768eab))
* **asr:** gate and rebuild worklet assets ([9f5f6ca](https://github.com/zlxlabs/herdweb/commit/9f5f6ca15c45c2a3ff9cd602b928929c6615248d))
* **asr:** harden pcm and frame decoding ([69e9cb3](https://github.com/zlxlabs/herdweb/commit/69e9cb326746377e01112a6cc45cbe3610d00824))
* **asr:** harden placement and connection observers ([a7c15e7](https://github.com/zlxlabs/herdweb/commit/a7c15e77e9c8089050f6abb9b0760bec68b8f154))
* **asr:** include worklet port backpressure ([cc17ec2](https://github.com/zlxlabs/herdweb/commit/cc17ec2c331d0b31540785fd9b885bf6fbf2ccc3))
* **asr:** keep composer closed during draft restore ([a78f65a](https://github.com/zlxlabs/herdweb/commit/a78f65a695193f34415840b7058d12fa69748fda))
* **asr:** keep schema path typing lint-clean ([bd9aaeb](https://github.com/zlxlabs/herdweb/commit/bd9aaebe46d2f426e52aa2596d2d8dc16547840f))
* **asr:** keep visibility cancellation feedback ([0bc9659](https://github.com/zlxlabs/herdweb/commit/0bc9659ed1338dbf5d0e96069da170c52d2ba9cc))
* **asr:** lock lifecycle interleaving contracts ([efa5bd7](https://github.com/zlxlabs/herdweb/commit/efa5bd7506afea1064f1c30f88fd2dc6a77e48cb))
* **asr:** preserve composer after audio interruption ([8083563](https://github.com/zlxlabs/herdweb/commit/80835637e5dbbb1c34f6063df4ddd6976bca4848))
* **asr:** preserve engine websocket errors ([7c01e86](https://github.com/zlxlabs/herdweb/commit/7c01e861c8302714fafa264ef6a219cea176c512))
* **asr:** prevent HTML config caching [codex] ([ee71d0f](https://github.com/zlxlabs/herdweb/commit/ee71d0fe14e7e5e9ca781343e7dddadeda9bad3f))
* **asr:** remove protocol type assertion ([50a2207](https://github.com/zlxlabs/herdweb/commit/50a220793a6eaed2defe559e6b627cd0f9878ac3))
* **asr:** remove unused protocol and pcm wrappers ([d74239f](https://github.com/zlxlabs/herdweb/commit/d74239f2402f7abdd94133d4901c4cb88925705e))
* **asr:** require credentials for enabled config ([1299462](https://github.com/zlxlabs/herdweb/commit/1299462a7aca6de1fa67eb1943c100998aefccb0))
* **asr:** satisfy composer persistence lint ([152126d](https://github.com/zlxlabs/herdweb/commit/152126d1a6a9f64549d59074e5e832124b00385e))
* **asr:** save drafts over corrupt storage ([565a4ab](https://github.com/zlxlabs/herdweb/commit/565a4ab985a75aec536cb429f538eccef167eb04))
* **asr:** send voice preview while recording ([f734847](https://github.com/zlxlabs/herdweb/commit/f734847d1757d85cdf4bd373b26682993fde36c2))
* **asr:** serialize capture stop failures ([843671b](https://github.com/zlxlabs/herdweb/commit/843671b897448518c7fa034f2cd57548ef8b7c3d))
* **asr:** set browser websocket binary type ([ad58e92](https://github.com/zlxlabs/herdweb/commit/ad58e92d5eee3dbb45b98d89d0a8a3d4bbb44a45))
* **asr:** show mic session feedback and retry errors ([32ce1a3](https://github.com/zlxlabs/herdweb/commit/32ce1a380fcbf58bfa2f08bf4db79d5c97a83efc))
* **asr:** surface browser audio interruptions ([57abc1e](https://github.com/zlxlabs/herdweb/commit/57abc1eefd1c32fc0eeeee2be335c95e5ac05803))
* **ci:** add npm to mise.toml for OIDC trusted publishing ([62bfd3a](https://github.com/zlxlabs/herdweb/commit/62bfd3a79864dfe60c0edc0bd6528be0bfbf5e34))
* **ci:** gate release on CI success ([0171dcf](https://github.com/zlxlabs/herdweb/commit/0171dcf1a7bd07b9bf92be9c7889ce345432eed3))
* **ci:** pin ttyd 1.7.7 via mise — fixes prefix e2e failures ([2e88df3](https://github.com/zlxlabs/herdweb/commit/2e88df39734c427b7973015e64f43a6b958c1cc1))
* clamp persisted font size to the current sizeRange [kimi] ([a07dedc](https://github.com/zlxlabs/herdweb/commit/a07dedcd39ee109debd893d26aa670c639eefa04))
* **client:** count protocol faults as sync failures ([3245ba9](https://github.com/zlxlabs/herdweb/commit/3245ba92c801c07213ee2d2cca50680e60626ccd))
* **client:** detect sustained send buffering ([1163ed3](https://github.com/zlxlabs/herdweb/commit/1163ed36d0b7c8a16155792f11d83b88586f81a9))
* **client:** enforce snapshot deadline and epoch isolation ([2447cec](https://github.com/zlxlabs/herdweb/commit/2447cec6aa233d4ff4dc4621f8259c5712dd024a))
* **client:** gate pageshow reconnect on freshness proof ([77153a5](https://github.com/zlxlabs/herdweb/commit/77153a52f80b26045d17a9e27b005f4d631a8db8))
* **client:** guard pageshow reconnect during initial WebKit handshake ([4af9a01](https://github.com/zlxlabs/herdweb/commit/4af9a0100949f03c3ad23173933cac11f75363d8))
* **client:** invalidate connection on lifecycle loss ([b46c14f](https://github.com/zlxlabs/herdweb/commit/b46c14f1e8ca0dc7a301b6bbd263c3ea0bc4fec4))
* **client:** keep lifecycle alive after beforeunload ([9034f83](https://github.com/zlxlabs/herdweb/commit/9034f8335d232b2638b018f32796f30207b6fc9a))
* **client:** preserve connecting socket during recovery ([9ea242c](https://github.com/zlxlabs/herdweb/commit/9ea242c3a514cdb8731f5865a5b5111c6c1a8fdc))
* **client:** preserve connecting socket during recovery ([bd5a55d](https://github.com/zlxlabs/herdweb/commit/bd5a55de7a60cdbdb51ed93c71725dc200bbe046))
* **client:** preserve session-exit reconnect notice ([4047d59](https://github.com/zlxlabs/herdweb/commit/4047d598fc425e2747f7037736f0a750898fca8e))
* **client:** require connection status bridge methods ([e03317c](https://github.com/zlxlabs/herdweb/commit/e03317c6e25a2dab4f4f857b6112e7ff2932e466))
* **client:** require recent freshness proof for input ([63949b3](https://github.com/zlxlabs/herdweb/commit/63949b3f56656d1d1f81b3a7b5f280a4726fde85))
* **client:** stop reconnecting after session exit ([7a70ee3](https://github.com/zlxlabs/herdweb/commit/7a70ee30c98ae50b6d903a42c44fc54fe235c7fb))
* **client:** tolerate transient send buffering ([dfe0e91](https://github.com/zlxlabs/herdweb/commit/dfe0e9150f18dd56373c41f45b040918a01c1316))
* **cli:** scaffold portable configs and support base paths ([816dcb6](https://github.com/zlxlabs/herdweb/commit/816dcb6fbde3104fc3c77d7a9f697a82912b2787))
* **config:** validate scroll momentum friction and minVelocity ranges ([73ce962](https://github.com/zlxlabs/herdweb/commit/73ce9626910fbe962741b8e5eccbba67a65b8f43))
* **controls:** drawer × no longer steals terminal focus [kimi] ([3322726](https://github.com/zlxlabs/herdweb/commit/33227266f04538093e3410308e9e28044f6a7756))
* exclude package.json from Biome formatter ([eb88ac5](https://github.com/zlxlabs/herdweb/commit/eb88ac525c4acd04afe8b01ae71b80295ebce508))
* **gestures:** repair scroll engine tsc errors and cancel semantics ([5a039a7](https://github.com/zlxlabs/herdweb/commit/5a039a76d84ec2d6921e72d37b024e401deba172))
* **gestures:** throttle scroll wheel sends to 30Hz without losing displacement ([46845f3](https://github.com/zlxlabs/herdweb/commit/46845f3d00c8d8f7aae7faa6b8bebf54089215ae))
* guard handleClientMessage against resize on exited PTY ([41043ee](https://github.com/zlxlabs/herdweb/commit/41043eee23b86005d180ecae770c1055aaa538de))
* guard process.argv[1] for strict index access ([fd07a60](https://github.com/zlxlabs/herdweb/commit/fd07a6026135caffc189ba40fc0051d5ee9215fa))
* **image-drop:** always clean the partial file and polish the status panel ([c38fc19](https://github.com/zlxlabs/herdweb/commit/c38fc19851741603e47f17fe5a8ab5049e644b07))
* **lint:** stop exporting module-local COMPOSER_STORAGE_KEY_PREFIX ([4387651](https://github.com/zlxlabs/herdweb/commit/4387651f4194110702dc87bb44502d8db5b58744))
* load Unicode11Addon on headless mirror to align character widths ([54a3ec5](https://github.com/zlxlabs/herdweb/commit/54a3ec5b875098758d1a1b3d466f7517e025cc57))
* **mobile:** auto toggle transition reads focus semantics only (T-B) ([9b840a3](https://github.com/zlxlabs/herdweb/commit/9b840a3f2fc46dfe83e482f639a528ffb9a05eb4))
* **mobile:** cover drawer/floating keyboard-toggle wiring + document-level indicator ([d90ee1e](https://github.com/zlxlabs/herdweb/commit/d90ee1eb96dbd6428c001ebe278806d7074d760e))
* **mobile:** dispose the keyboard controller with the overlay lifecycle ([adf947e](https://github.com/zlxlabs/herdweb/commit/adf947e184b1f06d56909d7d76464c8a2fdf9aa2)), closes [T-E#4](https://github.com/T-E/issues/4)
* **mobile:** escape hatch checks reachability, not mere existence ([aab6c86](https://github.com/zlxlabs/herdweb/commit/aab6c861475865e68d5572763461a88665671041))
* **mobile:** keep keyboard-unlock focus from being stolen (touchend race) ([a242992](https://github.com/zlxlabs/herdweb/commit/a242992bdb2c37eaf3d63d516346b217cd739743))
* persist pinch-adjusted font size at gesture end [kimi] ([a8af9b4](https://github.com/zlxlabs/herdweb/commit/a8af9b436b6cf30b05e026f63d5d4fe1a6547d5c))
* posix_spawnp failed on macos ([#22](https://github.com/zlxlabs/herdweb/issues/22)) ([b971db1](https://github.com/zlxlabs/herdweb/commit/b971db17ef37933183811a3e90aeafa4b22da472))
* prevent drawer from immediately closing on touch devices ([5cbfefe](https://github.com/zlxlabs/herdweb/commit/5cbfefec93d24ff11d9014b47a9da6effe56335c))
* prevent synthesised click from closing overlays opened by touch ([e5a625d](https://github.com/zlxlabs/herdweb/commit/e5a625db8dadec33c40046a90d230ebe0847b837))
* **protocol:** remove unreachable pty write reason ([83870e3](https://github.com/zlxlabs/herdweb/commit/83870e3d62ad3845ca30daf654371f81c973d8b9))
* **reconnect:** retain explicit connection notices ([0716a79](https://github.com/zlxlabs/herdweb/commit/0716a7900d13dcac2285d9d62c18045059a17623))
* **reconnect:** use English action labels ([d578ad1](https://github.com/zlxlabs/herdweb/commit/d578ad1430b50c61a3a678ec4a0e2b63696a72d7))
* **release:** inline semantic-release config in package.json ([2f48dff](https://github.com/zlxlabs/herdweb/commit/2f48dffa522ef15e42154c0289deac0719793d4c))
* **release:** ship CJS config so semantic-release actually loads it ([ed58ab1](https://github.com/zlxlabs/herdweb/commit/ed58ab12a2970091704a14b67d3313b67251e968))
* remove leading ./ from bin path for npm 11 compatibility ([b350ecb](https://github.com/zlxlabs/herdweb/commit/b350ecbe8197346c91f78bdb64bc2906b483a047))
* remove redundant checks from prepublishOnly ([9f2247c](https://github.com/zlxlabs/herdweb/commit/9f2247c6a915578e7c7e1394fd9f562c7faea70c))
* remove terminal padding that exposed white document background ([cd92504](https://github.com/zlxlabs/herdweb/commit/cd92504c93bbc223979a3c77b60a90b0f10a13da)), closes [#terminal](https://github.com/zlxlabs/herdweb/issues/terminal)
* resolve symlink in entry guard so npx execution works ([f2409e1](https://github.com/zlxlabs/herdweb/commit/f2409e1ae63540f5594cc2384b76f6be4a701c2b))
* respond to touch events on all buttons for iOS Safari ([5af6dda](https://github.com/zlxlabs/herdweb/commit/5af6ddadfc6865be05ffff976da661db100b6783)), closes [#19](https://github.com/zlxlabs/herdweb/issues/19)
* **schema:** coerce null issue.expected for widened action variant ([2e6fe75](https://github.com/zlxlabs/herdweb/commit/2e6fe759037bbcdba400518d9c9d0218054c1669))
* scope CSP connect-src WebSocket to same host ([75f2149](https://github.com/zlxlabs/herdweb/commit/75f21498e175593393450ee240c967a76ee79468))
* **scroll:** set linesPerWheel default to 1 for herdr ([e331da7](https://github.com/zlxlabs/herdweb/commit/e331da795933436b2d3fa9981ad8c7c06b3d3b6d))
* seal __remobiSockets global ([be6e2db](https://github.com/zlxlabs/herdweb/commit/be6e2db1546eeca393e6e486289536bfd1f52f98))
* **security:** escape font CDN URL and tighten WS origin check ([1c55d5c](https://github.com/zlxlabs/herdweb/commit/1c55d5c28d85d14fc42a90813d4e479b531e4243))
* **serve:** canonicalise prefixed app entry ([d03168b](https://github.com/zlxlabs/herdweb/commit/d03168bfe1a5020ec70d6a22a318a3aa8fec0ac2))
* **serve:** chmod node-pty spawn-helper at runtime instead of via postinstall ([1043e8d](https://github.com/zlxlabs/herdweb/commit/1043e8de29f9feebcdee4e0742630015bb65753a))
* **serve:** default remobi serve to localhost ([6b8706e](https://github.com/zlxlabs/herdweb/commit/6b8706ec144ff2c92f92538a2c39997534b32e4d))
* **session:** fail loud on synchronous PTY errors ([91ca7b7](https://github.com/zlxlabs/herdweb/commit/91ca7b777648bc8190f302cbc12a9c7ed6c62f62))
* **session:** replay SGR mouse encoding in client snapshots ([72357a0](https://github.com/zlxlabs/herdweb/commit/72357a05662231c256097eeb7476d19a94be7a62))
* set document background from theme to eliminate white border ([5c821ca](https://github.com/zlxlabs/herdweb/commit/5c821ca9d7e4aaea6ac6531bc93116b24166807e)), closes [#1e1e2e](https://github.com/zlxlabs/herdweb/issues/1e1e2e) [#terminal-container](https://github.com/zlxlabs/herdweb/issues/terminal-container) [#terminal](https://github.com/zlxlabs/herdweb/issues/terminal)
* **setup:** clarify config auto-discovery validation ([99267f3](https://github.com/zlxlabs/herdweb/commit/99267f3f1fd84002cff187517f0b4c20863f0664))
* **skill:** repoint .claude/skills symlink to herdweb-setup ([f71774a](https://github.com/zlxlabs/herdweb/commit/f71774a6de2a9662131783ed6ff7f9c2b17e5475))
* **skills:** repoint tracked skills symlink to herdweb-setup ([0360d5a](https://github.com/zlxlabs/herdweb/commit/0360d5a180a0614974b8bc45c31b8a9f30d63ffd))
* stop buttons opening keyboard on Android ([d40fa46](https://github.com/zlxlabs/herdweb/commit/d40fa4662f11f3fc43b02019b186670cf06f0df1))
* strip TMUX env vars via destructuring instead of undefined assignment ([33fa6ec](https://github.com/zlxlabs/herdweb/commit/33fa6ec2ee550db3d88e789afd989735918685db))
* tighten CSP with script-src directive ([5a076fe](https://github.com/zlxlabs/herdweb/commit/5a076fedf3bd08ed81f9c54c90f91dcdaabe8ac9))
* use crypto PRNG for internal ttyd port ([10e7493](https://github.com/zlxlabs/herdweb/commit/10e7493ebf499ef813354548b8c31ced52602589))


### chore

* mark built-in runtime migration as breaking ([20d466b](https://github.com/zlxlabs/herdweb/commit/20d466b68d861c697b90b51524f7a2956ca33e50))


### Features

* add double-tap gesture for configurable terminal action ([7999f8e](https://github.com/zlxlabs/herdweb/commit/7999f8e625bdd38e6df900de6f1e36f3f25b5e2e))
* add pixel R> logo and integrate across project ([0235c4b](https://github.com/zlxlabs/herdweb/commit/0235c4be3f1d0b503f4531a4c8adc90283eece0f))
* **asr:** add Doubao engine and mock endpoint ([e710f56](https://github.com/zlxlabs/herdweb/commit/e710f56089fec48ff91b8d7f76bcd5aeab806d70))
* **asr:** add PCM chunking and audio worklet ([3b7e239](https://github.com/zlxlabs/herdweb/commit/3b7e23939498e1c7a3a715099bfbc939d91bf1d9))
* **asr:** add push-to-talk preview and injection ([5774f97](https://github.com/zlxlabs/herdweb/commit/5774f974c3b02912ca2202929a73ebee4127e77f))
* **asr:** add SAUC frame protocol ([9834ca7](https://github.com/zlxlabs/herdweb/commit/9834ca7192743099692aaeea7e23469e2b4080ab))
* **asr:** add voice composer shell ([aa43dc3](https://github.com/zlxlabs/herdweb/commit/aa43dc3e59ce1738055beaa99513b81a45f0e160))
* **asr:** append interrupted voice drafts ([7df3984](https://github.com/zlxlabs/herdweb/commit/7df3984e10e3d8196db331bf37dca36fb4b21a5b))
* **asr:** cover backpressure and capture cleanup ([fa47943](https://github.com/zlxlabs/herdweb/commit/fa479433179bf1e83db2626d772611901c861af4))
* **asr:** harden push-to-talk lifecycle ([cb39623](https://github.com/zlxlabs/herdweb/commit/cb39623033d5af671ac9db3dc0a8465a7552c80b))
* **asr:** keep composer open across sends ([9ad0b5b](https://github.com/zlxlabs/herdweb/commit/9ad0b5b112f6f0fc593eb4cbaa347b7ceafbec10))
* **asr:** keep mic taps focus-safe and circular ([658a176](https://github.com/zlxlabs/herdweb/commit/658a1767034e0003b2b720d54441bef3449a6c02))
* **asr:** move voice composer to bottom chrome ([4d92300](https://github.com/zlxlabs/herdweb/commit/4d9230058ea538ed33a9200d261d03923e329cae))
* **asr:** persist composer draft schema ([40ea80c](https://github.com/zlxlabs/herdweb/commit/40ea80cf05eb7a8dc506894431ec4e05a3120f1b))
* **asr:** reserve viewport space for composer ([fd0a51c](https://github.com/zlxlabs/herdweb/commit/fd0a51cb31f09dc805143bf1887a07237f862ed7))
* **asr:** restore composer drafts on page return ([a9c4fff](https://github.com/zlxlabs/herdweb/commit/a9c4fffa57844e881ae981058301f6af62936479))
* **asr:** split composer and microphone controls ([958761d](https://github.com/zlxlabs/herdweb/commit/958761d3eb27a705a3cca2bb2936b7dc280f03f3))
* **asr:** submit voice composer as pending action ([ba4c824](https://github.com/zlxlabs/herdweb/commit/ba4c824cb96fc47d39eaad614ea0c08f5e0dd385))
* **asr:** support multiline composer drafts ([bc9a186](https://github.com/zlxlabs/herdweb/commit/bc9a18682359cc54081d81372bf71ecdb7f1b67b))
* **asr:** switch mic input to tap toggle ([1801713](https://github.com/zlxlabs/herdweb/commit/180171325175e185efa8a421a468fcfb313d90a4))
* **asr:** tighten protocol decoding types ([80c53de](https://github.com/zlxlabs/herdweb/commit/80c53de96713a97845d6d1da318f5ebd92636903))
* **asr:** wire config security and worklet assets ([9451f1b](https://github.com/zlxlabs/herdweb/commit/9451f1bc2b93564f07caf2d3c12cc35fb07b1dc3))
* **asr:** wire voice input action and terminal connection state ([f64dc57](https://github.com/zlxlabs/herdweb/commit/f64dc57235fbda184da5a2949bbbd67e7f7ad563))
* **client:** add fresh connection state machine ([918db8c](https://github.com/zlxlabs/herdweb/commit/918db8cd371157ede15d4238afa7a0f5f6c263dd))
* **client:** bridge acknowledged input actions ([bcd237a](https://github.com/zlxlabs/herdweb/commit/bcd237a3881f8cc22c41793431bc4ebfe78d51fc))
* **composer:** one-handed actions row — centred 64px mic, fixed-width send, 72px recording stop ([9964532](https://github.com/zlxlabs/herdweb/commit/9964532d3f06beb291fc35bf2d9aa6d4922dface))
* **controls:** add dpad-toggle action member [kimi] ([390c692](https://github.com/zlxlabs/herdweb/commit/390c6920cee074dc7e8a95bbddc9549c292f36c5))
* **controls:** add Font -/Font +/Guide to default drawer, drop Top-Right help section ([a3c945a](https://github.com/zlxlabs/herdweb/commit/a3c945a94cef5938212000e6f278587c8216e746))
* **controls:** add font-size/help action types and fail-loud dispatch ([2e47272](https://github.com/zlxlabs/herdweb/commit/2e4727215256840251d9afa257e5c26d7e85add5))
* **controls:** default scrollButtons off, add safe-area insets for floating UI ([302b0a7](https://github.com/zlxlabs/herdweb/commit/302b0a7062d4faae3b1f9e16f8d228526805af5b)), closes [#wt-scroll-buttons](https://github.com/zlxlabs/herdweb/issues/wt-scroll-buttons)
* **controls:** floating d-pad with focus-safe keys [kimi] ([40474b4](https://github.com/zlxlabs/herdweb/commit/40474b48124ba0c0d8982a16e66564057a964de8))
* **controls:** mark failed action buttons with a visible error state ([c5afff9](https://github.com/zlxlabs/herdweb/commit/c5afff9e203b2e9f769edf80efd28799f1c20f6d))
* **controls:** move font-size logic into action handlers, drop floating font controls ([c0eadb7](https://github.com/zlxlabs/herdweb/commit/c0eadb75c6f00cfd7490b4222e45852b8b0ae294)), closes [#wt-font-controls](https://github.com/zlxlabs/herdweb/issues/wt-font-controls)
* **drawer:** explicit × close button in the handle area [kimi] ([a5b7b6d](https://github.com/zlxlabs/herdweb/commit/a5b7b6d634ce0c587bdca52ea870be0fb6cf2787))
* **drawer:** keep drawer open for font-size and help actions [kimi] ([03b0939](https://github.com/zlxlabs/herdweb/commit/03b09395f9537b650aadfe5db298c161894393fd))
* **font:** default mobile font size 13 + persist adjustments [kimi] ([d4149f6](https://github.com/zlxlabs/herdweb/commit/d4149f692782eedaea772b6c8b85a1ff8651f659))
* **gestures:** default swipe off — horizontal swipes belong to the toolbar row [kimi] ([e50a9b4](https://github.com/zlxlabs/herdweb/commit/e50a9b40c3128572839aab120c6fa4be08d010fd))
* **gestures:** rewrite mobile scroll as rAF follow-finger engine ([50db71a](https://github.com/zlxlabs/herdweb/commit/50db71a9de2c09f12b72633812375159cc2df2da))
* **image-drop:** add client controller with session-guarded path insertion ([613fcbc](https://github.com/zlxlabs/herdweb/commit/613fcbc733289b4d62560a99089bc3499532d13a))
* **image-drop:** add image-upload action and default drawer button ([3190376](https://github.com/zlxlabs/herdweb/commit/3190376013f0720a64f0c0b1403c4e0f8045e27c))
* **image-drop:** add raw image upload endpoint with magic-byte sniffing ([62589be](https://github.com/zlxlabs/herdweb/commit/62589bec892792157b29d8420551c1f5e05c8a24))
* **image-drop:** promote the image button to the toolbar and make success a transient toast ([82d49f8](https://github.com/zlxlabs/herdweb/commit/82d49f8745b950719719697667332b05c5cdbd2e))
* **keyboard:** inject manual-mode escape hatch into toolbar row1 [kimi] ([ece0364](https://github.com/zlxlabs/herdweb/commit/ece03642294d46ca4b6bfd3bd74f2e85136f0025))
* **mobile:** add keyboardMode config ('auto' | 'manual', default 'auto') ([b0842e0](https://github.com/zlxlabs/herdweb/commit/b0842e0144ee26e0435f7bcff31fa83c8d2098e0))
* **mobile:** extend XTerminal with keyboard suppression semantics ([186f90d](https://github.com/zlxlabs/herdweb/commit/186f90d52b00c25016383b1ba36578fcf9dccdcd))
* **mobile:** keyboard-toggle button on toolbar row2 + indicator + CSS fixes ([560a249](https://github.com/zlxlabs/herdweb/commit/560a2490061fd40d32fed304d3cb2f225854b7dd))
* **mobile:** shared keyboard controller + keyboard-toggle action dispatch ([3301702](https://github.com/zlxlabs/herdweb/commit/33017024e954b5f388724224c01719d63645e23b))
* **mobile:** wire escape hatch + fail-loud overlay into init ([9fa1f77](https://github.com/zlxlabs/herdweb/commit/9fa1f7756808e429bb60550be41b8a7e38151dda)), closes [T-E#6](https://github.com/T-E/issues/6)
* prefix button sends prefix then opens combo picker ([cae17de](https://github.com/zlxlabs/herdweb/commit/cae17de6889658da8cc46ee8f917b542b4582bb3))
* **protocol:** add fresh-session and input-action fields ([f822d94](https://github.com/zlxlabs/herdweb/commit/f822d94a8a841249b174ee3d1ee687cdcfe2ade5))
* **serve:** support herdr as target multiplexer ([deb6ab0](https://github.com/zlxlabs/herdweb/commit/deb6ab07677a14b72654630342c7955ff68c6145))
* **serve:** support zellij as target multiplexer ([3ee6a81](https://github.com/zlxlabs/herdweb/commit/3ee6a81551de4ecb02b9ec6a5c384cfae6edeea8)), closes [zellij-org/zellij#4049](https://github.com/zellij-org/zellij/issues/4049)
* **session:** watermark snapshots with sequenced output ([29f6c6a](https://github.com/zlxlabs/herdweb/commit/29f6c6ada0d03a23b4a1e15021db3e815459417f))
* show version in help overlay ([eab3272](https://github.com/zlxlabs/herdweb/commit/eab3272e979bcd4cf281325d90c9546d9794b565))
* **toolbar:** 8-key single row with a dedicated C-c key [kimi] ([b314b2a](https://github.com/zlxlabs/herdweb/commit/b314b2a647827aef66c071a7af8ec292672272af))
* **toolbar:** moshi-style single-row default layout [kimi] ([04ff2f4](https://github.com/zlxlabs/herdweb/commit/04ff2f499346ee77690bf933e013fc14cf171ff0))
* **toolbar:** reorder default portrait row1 — drop ⌫, promote 🎤, iconify ☰ ([8e3ad5c](https://github.com/zlxlabs/herdweb/commit/8e3ad5c66663c83aa70838a0537e2f69f70b65c4))
* **toolbar:** seven-key default row, arrows move to the d-pad [kimi] ([37486a7](https://github.com/zlxlabs/herdweb/commit/37486a74886c4a717b24715e2c6bd47c762edbf7))
* **toolbar:** swap row1 Tab for dedicated ⌫ Backspace [kimi] ([aaa1348](https://github.com/zlxlabs/herdweb/commit/aaa1348f22c2800430a2de57d474936a7f272072))


### Reverts

* chore(release): 1.1.0 ([1ec30f9](https://github.com/zlxlabs/herdweb/commit/1ec30f92ee1e46f2b33b7a201e04c910ae3d9c53))


### BREAKING CHANGES

* remobi replaces the ttyd-based runtime with the built-in terminal runtime.

## [1.2.1](https://github.com/connorads/remobi/compare/v1.2.0...v1.2.1) (2026-07-16)


### Bug Fixes

* **session:** replay SGR mouse encoding in client snapshots ([72357a0](https://github.com/connorads/remobi/commit/72357a05662231c256097eeb7476d19a94be7a62))

# [1.2.0](https://github.com/connorads/remobi/compare/v1.1.0...v1.2.0) (2026-07-14)


### Features

* **serve:** support zellij as target multiplexer ([3ee6a81](https://github.com/connorads/remobi/commit/3ee6a81551de4ecb02b9ec6a5c384cfae6edeea8)), closes [zellij-org/zellij#4049](https://github.com/zellij-org/zellij/issues/4049)

# [1.1.0](https://github.com/connorads/remobi/compare/v1.0.4...v1.1.0) (2026-07-14)


### Features

* **serve:** support herdr as target multiplexer ([deb6ab0](https://github.com/connorads/remobi/commit/deb6ab07677a14b72654630342c7955ff68c6145))


### Reverts

* chore(release): 1.1.0 ([1ec30f9](https://github.com/connorads/remobi/commit/1ec30f92ee1e46f2b33b7a201e04c910ae3d9c53))

## [1.0.4](https://github.com/connorads/remobi/compare/v1.0.3...v1.0.4) (2026-06-23)


### Bug Fixes

* **serve:** chmod node-pty spawn-helper at runtime instead of via postinstall ([1043e8d](https://github.com/connorads/remobi/commit/1043e8de29f9feebcdee4e0742630015bb65753a))

## [1.0.3](https://github.com/connorads/remobi/compare/v1.0.2...v1.0.3) (2026-04-01)


### Bug Fixes

* **cli:** scaffold portable configs and support base paths ([816dcb6](https://github.com/connorads/remobi/commit/816dcb6fbde3104fc3c77d7a9f697a82912b2787))
* **serve:** canonicalise prefixed app entry ([d03168b](https://github.com/connorads/remobi/commit/d03168bfe1a5020ec70d6a22a318a3aa8fec0ac2))

## [1.0.2](https://github.com/connorads/remobi/compare/v1.0.1...v1.0.2) (2026-03-29)


### Bug Fixes

* posix_spawnp failed on macos ([#22](https://github.com/connorads/remobi/issues/22)) ([b971db1](https://github.com/connorads/remobi/commit/b971db17ef37933183811a3e90aeafa4b22da472))

## [1.0.1](https://github.com/connorads/remobi/compare/v1.0.0...v1.0.1) (2026-03-27)


### Bug Fixes

* **setup:** clarify config auto-discovery validation ([99267f3](https://github.com/connorads/remobi/commit/99267f3f1fd84002cff187517f0b4c20863f0664))

# [1.0.0](https://github.com/connorads/remobi/compare/v0.5.0...v1.0.0) (2026-03-27)


### Bug Fixes

* guard handleClientMessage against resize on exited PTY ([41043ee](https://github.com/connorads/remobi/commit/41043eee23b86005d180ecae770c1055aaa538de))
* load Unicode11Addon on headless mirror to align character widths ([54a3ec5](https://github.com/connorads/remobi/commit/54a3ec5b875098758d1a1b3d466f7517e025cc57))
* remove terminal padding that exposed white document background ([cd92504](https://github.com/connorads/remobi/commit/cd92504c93bbc223979a3c77b60a90b0f10a13da)), closes [#terminal](https://github.com/connorads/remobi/issues/terminal)
* set document background from theme to eliminate white border ([5c821ca](https://github.com/connorads/remobi/commit/5c821ca9d7e4aaea6ac6531bc93116b24166807e)), closes [#1e1e2e](https://github.com/connorads/remobi/issues/1e1e2e) [#terminal-container](https://github.com/connorads/remobi/issues/terminal-container) [#terminal](https://github.com/connorads/remobi/issues/terminal)
* strip TMUX env vars via destructuring instead of undefined assignment ([33fa6ec](https://github.com/connorads/remobi/commit/33fa6ec2ee550db3d88e789afd989735918685db))


### chore

* mark built-in runtime migration as breaking ([20d466b](https://github.com/connorads/remobi/commit/20d466b68d861c697b90b51524f7a2956ca33e50))


### BREAKING CHANGES

* remobi replaces the ttyd-based runtime with the built-in terminal runtime.

# [1.0.0-dev.1](https://github.com/connorads/remobi/compare/v0.5.1-dev.2...v1.0.0-dev.1) (2026-03-27)


### chore

* mark built-in runtime migration as breaking ([20d466b](https://github.com/connorads/remobi/commit/20d466b68d861c697b90b51524f7a2956ca33e50))


### BREAKING CHANGES

* remobi replaces the ttyd-based runtime with the built-in terminal runtime.

## [0.5.1-dev.2](https://github.com/connorads/remobi/compare/v0.5.1-dev.1...v0.5.1-dev.2) (2026-03-24)


### Bug Fixes

* load Unicode11Addon on headless mirror to align character widths ([54a3ec5](https://github.com/connorads/remobi/commit/54a3ec5b875098758d1a1b3d466f7517e025cc57))
* remove terminal padding that exposed white document background ([cd92504](https://github.com/connorads/remobi/commit/cd92504c93bbc223979a3c77b60a90b0f10a13da)), closes [#terminal](https://github.com/connorads/remobi/issues/terminal)
* set document background from theme to eliminate white border ([5c821ca](https://github.com/connorads/remobi/commit/5c821ca9d7e4aaea6ac6531bc93116b24166807e)), closes [#1e1e2e](https://github.com/connorads/remobi/issues/1e1e2e) [#terminal-container](https://github.com/connorads/remobi/issues/terminal-container) [#terminal](https://github.com/connorads/remobi/issues/terminal)
* strip TMUX env vars via destructuring instead of undefined assignment ([33fa6ec](https://github.com/connorads/remobi/commit/33fa6ec2ee550db3d88e789afd989735918685db))

## [0.5.1-dev.1](https://github.com/connorads/remobi/compare/v0.5.0...v0.5.1-dev.1) (2026-03-22)


### Bug Fixes

* guard handleClientMessage against resize on exited PTY ([41043ee](https://github.com/connorads/remobi/commit/41043eee23b86005d180ecae770c1055aaa538de))

# [0.5.0](https://github.com/connorads/remobi/compare/v0.4.0...v0.5.0) (2026-03-20)


### Bug Fixes

* **ci:** pin ttyd 1.7.7 via mise — fixes prefix e2e failures ([2e88df3](https://github.com/connorads/remobi/commit/2e88df39734c427b7973015e64f43a6b958c1cc1))


### Features

* prefix button sends prefix then opens combo picker ([cae17de](https://github.com/connorads/remobi/commit/cae17de6889658da8cc46ee8f917b542b4582bb3))

# [0.4.0](https://github.com/connorads/remobi/compare/v0.3.1...v0.4.0) (2026-03-20)


### Features

* add double-tap gesture for configurable terminal action ([7999f8e](https://github.com/connorads/remobi/commit/7999f8e625bdd38e6df900de6f1e36f3f25b5e2e))

## [0.3.1](https://github.com/connorads/remobi/compare/v0.3.0...v0.3.1) (2026-03-20)


### Bug Fixes

* prevent synthesised click from closing overlays opened by touch ([e5a625d](https://github.com/connorads/remobi/commit/e5a625db8dadec33c40046a90d230ebe0847b837))

# [0.3.0](https://github.com/connorads/remobi/compare/v0.2.7...v0.3.0) (2026-03-20)


### Bug Fixes

* prevent drawer from immediately closing on touch devices ([5cbfefe](https://github.com/connorads/remobi/commit/5cbfefec93d24ff11d9014b47a9da6effe56335c))
* stop buttons opening keyboard on Android ([d40fa46](https://github.com/connorads/remobi/commit/d40fa4662f11f3fc43b02019b186670cf06f0df1))


### Features

* show version in help overlay ([eab3272](https://github.com/connorads/remobi/commit/eab3272e979bcd4cf281325d90c9546d9794b565))

## [0.2.7](https://github.com/connorads/remobi/compare/v0.2.6...v0.2.7) (2026-03-19)


### Bug Fixes

* respond to touch events on all buttons for iOS Safari ([5af6dda](https://github.com/connorads/remobi/commit/5af6ddadfc6865be05ffff976da661db100b6783)), closes [#19](https://github.com/connorads/remobi/issues/19)

## [0.2.6](https://github.com/connorads/remobi/compare/v0.2.5...v0.2.6) (2026-03-17)


### Bug Fixes

* **ci:** gate release on CI success ([0171dcf](https://github.com/connorads/remobi/commit/0171dcf1a7bd07b9bf92be9c7889ce345432eed3))

## [0.2.5](https://github.com/connorads/remobi/compare/v0.2.4...v0.2.5) (2026-03-17)


### Bug Fixes

* add WS relay buffer size limit ([40478fb](https://github.com/connorads/remobi/commit/40478fb43e596078b2d3e94229db6aaf0533f06f))
* apply origin check to catch-all ttyd proxy ([240d8c3](https://github.com/connorads/remobi/commit/240d8c371baf97db0b98b0f5669e6ac9e0992595))
* scope CSP connect-src WebSocket to same host ([75f2149](https://github.com/connorads/remobi/commit/75f21498e175593393450ee240c967a76ee79468))
* seal __remobiSockets global ([be6e2db](https://github.com/connorads/remobi/commit/be6e2db1546eeca393e6e486289536bfd1f52f98))
* tighten CSP with script-src directive ([5a076fe](https://github.com/connorads/remobi/commit/5a076fedf3bd08ed81f9c54c90f91dcdaabe8ac9))
* use crypto PRNG for internal ttyd port ([10e7493](https://github.com/connorads/remobi/commit/10e7493ebf499ef813354548b8c31ced52602589))

## [0.2.4](https://github.com/connorads/remobi/compare/v0.2.3...v0.2.4) (2026-03-16)


### Bug Fixes

* **security:** escape font CDN URL and tighten WS origin check ([1c55d5c](https://github.com/connorads/remobi/commit/1c55d5c28d85d14fc42a90813d4e479b531e4243))

## [0.2.3](https://github.com/connorads/remobi/compare/v0.2.2...v0.2.3) (2026-03-16)


### Bug Fixes

* **serve:** default remobi serve to localhost ([6b8706e](https://github.com/connorads/remobi/commit/6b8706ec144ff2c92f92538a2c39997534b32e4d))

## [0.2.2](https://github.com/connorads/remobi/compare/v0.2.1...v0.2.2) (2026-03-16)

### Bug Fixes

* guard process.argv[1] for strict index access ([fd07a60](https://github.com/connorads/remobi/commit/fd07a6026135caffc189ba40fc0051d5ee9215fa))

## [0.2.1](https://github.com/connorads/remobi/compare/v0.2.0...v0.2.1) (2026-03-15)

### Bug Fixes

* resolve symlink in entry guard so npx execution works ([f2409e1](https://github.com/connorads/remobi/commit/f2409e1ae63540f5594cc2384b76f6be4a701c2b))

## [0.2.0](https://github.com/connorads/remobi/compare/v0.1.0...v0.2.0) (2026-03-15)

### Bug Fixes

* **ci:** add npm to mise.toml for OIDC trusted publishing ([62bfd3a](https://github.com/connorads/remobi/commit/62bfd3a79864dfe60c0edc0bd6528be0bfbf5e34))
* exclude package.json from Biome formatter ([eb88ac5](https://github.com/connorads/remobi/commit/eb88ac525c4acd04afe8b01ae71b80295ebce508))
* remove leading ./ from bin path for npm 11 compatibility ([b350ecb](https://github.com/connorads/remobi/commit/b350ecbe8197346c91f78bdb64bc2906b483a047))
* remove redundant checks from prepublishOnly ([9f2247c](https://github.com/connorads/remobi/commit/9f2247c6a915578e7c7e1394fd9f562c7faea70c))

### Features

* add pixel R> logo and integrate across project ([0235c4b](https://github.com/connorads/remobi/commit/0235c4be3f1d0b503f4531a4c8adc90283eece0f))

## 0.1.0 (2026-03-15)

### Breaking Changes

* migrated from Bun to Node.js 22+ with pnpm — runtime is now Node, bundler is esbuild, test runner is vitest, transpiler is tsdown; `remobi serve` uses Hono + @hono/node-ws; package ships transpiled JS (`dist/`) instead of TypeScript source
* unified toolbar/drawer model to `ControlButton` (`id`, `label`, `description`, `action`) and renamed `drawer.commands` to `drawer.buttons`
* `floatingButtons` changed from flat `ControlButton[]` to `FloatingButtonGroup[]` with `position`, optional `direction`, and `buttons` array
* removed plugin system (`RemobiPlugin`, `UISlot`, `UIContributionCollector`, plugin manager, UI contributions, build-time resolution, `config.plugins`) — hooks and actions remain as core infrastructure

### Features

* `remobi serve` — single command with full PWA support, overlay build, ttyd lifecycle, manifest + icons + WebSocket relay
* PWA support — web app manifest, 192/512px icons, apple-touch-icon, theme-color meta tags for "Add to Home Screen"
* reconnect overlay — detects connection loss via WebSocket interception, auto-reconnects on browser online event
* `remobi serve --no-sleep` — prevents macOS system sleep via `caffeinate -s -w <pid>`
* `floatingButtons` config — always-visible buttons on touch devices
* `gestures.swipe.left`/`right` and `leftLabel`/`rightLabel` for configurable swipe actions
* `mobile.initData` — arbitrary data sent to terminal on mobile init below width threshold
* `pwa` config section (`enabled`, `shortName`, `themeColor`)
* top-level `name` config field — used as document title, PWA manifest name, apple-mobile-web-app-title
* default toolbar backspace button (`⌫`) for reliable mobile deletion
* new drawer `Combo` action (`combo-picker`) for explicit Ctrl/Alt key sends
* default toolbar `q` button (row 2) for quitting interactive TUIs
* explicit tmux `Prefix` (`C-b`) and `Alt+Enter` toolbar buttons
* dynamic help overlay rendered from current config
* runtime config validation with path-based errors and unknown-key checks
* stricter CLI parsing (`-c`/`-o`/`-n`, unknown-flag errors) plus `--dry-run` for `build` and `inject`
* action registry abstraction for toolbar/drawer button handling
* typed hook registry for overlay lifecycle and terminal send pipeline
* declarative button customisation via `ButtonArrayInput`
* per-machine config overrides via `.local` config file
* overlay pre-built as IIFE during `build:dist` — faster `remobi serve` startup

### Bug Fixes

* visibilitychange listener leak in reconnect dispose path
* reconnect overlay retry on any tap, focused button for keyboard `Enter`, duplicate reload guard
* unhandled promise rejection when `document.fonts.ready` fails
* help overlay rewritten to DOM API (no innerHTML), eliminating XSS surface
* PWA meta-tag values HTML-attribute-escaped
* `waitForTerm` rejects after timeout (default 10s) instead of polling indefinitely
* help overlay is fail-safe and cannot block core overlay init
* viewport/keyboard height handling and document scroll lock for mobile
