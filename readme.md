## Overview

Adapter library for [Koa](http://koajs.com), a popular HTTP microframework for
Node.js. Allows you to write Koa middleware as `ƒ(request) -> response`, similar
to [Ring](https://github.com/ring-clojure/ring) in Clojure. See
[motivation](#functional-programming).

Includes optional support for implicit cancelation via
[Posterus](https://github.com/Mitranim/posterus) futures and coroutines. See
[motivation](#cancelation).

Includes support for basic routing and pattern-matching.

## TOC

  * [Overview](#overview)
  * [TOC](#toc)
  * [Usage](#usage)
  * [Motivation](#motivation)
  * [API](#api)
    * [Request](#request)
    * [Response](#response)
    * [`compose`](#compose)
    * [`toKoaMiddleware`](#tokoamiddleware)
    * [`mount`](#mount)
    * [`match`](#match)
    * [Futures](#futures)

## Usage

Shell:

```sh
npm install --exact koa-ring
```

Node:

```js
const Koa = require('koa')
const {compose, toKoaMiddleware} = require('koa-ring')

const app = new Koa()

app.use(toKoaMiddleware(compose([
  exampleMiddleware,
  // ...
  () => exampleHandler,
])))

function exampleMiddleware(nextHandler) {
  return async function prevHandler(request) {
    // do whatever
    // can substitute request
    const req = request
    const response = await nextHandler(req)
    // can substitute response
    return response
  }
}

function exampleHandler(request) {
  // Status and headers are optional
  return {status: 200, headers: {}, body: 'Hello world!'}
}
```

With cancelation support:

```js
const Koa = require('koa')
const {compose} = require('koa-ring')
const {toKoaMiddleware} = require('koa-ring/posterus')

const app = new Koa()

app.use(toKoaMiddleware(compose([
  next => request => next(request),
  next => function* (request) {return next(request)},
  // ...
  next => handler,
])))

function* handler(request) {
  // Could be a future-based database request, etc
  // This work is canceled if client disconnects
  const greeting = yield Future.fromResult('Hello world!')
  return {body: greeting}
}
```

See [API](#api) below.

## Motivation

### Functional Programming

In Koa, request handlers are imperative functions that take a request/response
context object, return `void` and mutate the context to send the response.

In other words, Koa is a poor match for the HTTP programming model, which lends
itself to `ƒ(request) -> response`, to plain functions of request to response.

Advantages of `ƒ(request) -> response`:

  * Easy to rewrite request and/or response at middleware level

  * Lends itself to function composition

  * You can often return response from another source, without writing the
    context-mutating code

  * Returning null instead of response makes it easy to signal "not found" or
    "noop" to the calling handler

Fortunately, we can fix this. We have the technology to write functions.

### Cancelation

JS promises lack cancelation, and are therefore fundamentally broken, unfit for
purpose.

On a server, you want each incoming request to own the work it starts. When the
request prematurely ends, this work must be aborted.

  * In Erlang, this tends to be the default: you create subprocesses using
    `spawn_link`, they're owned by the handler process and die with it.

  * In thread-based languages, this also works as long as you don't spawn
    another thread, as there's no analog of `spawn_link`.

  * In Go, you're out of luck, as there's no support for goroutine cancelation.

  * In Node.js, you can achieve this by using cancelable async primitives, such
    as [Posterus futures](https://github.com/Mitranim/posterus), and
    [coroutines](https://github.com/Mitranim/posterus#routine) built on them.

Concrete example:

```js
const {Future} = require('posterus')
const {routine} = require('posterus/routine')

function* koaRingHandler(request) {
  // If client disconnects, this invokes onDeinit, aborting work
  const one = yield expensiveFuture(request)
  // Delegate to another routine, implicitly owning it;
  // if the client disconnects, both routines are canceled, aborting work
  const other = yield expensiveRoutine(request)
  return {body: other}
}

// Futures can be canceled with `future.deinit()`
function expensiveFuture(...args) {
  return Future.init(future => {
    const operationId = expensiveOperation(...args, (error, result) => {
      future.arrive(error, result)
    })
    return function onDeinit() {
      cancelOperation(operationId)
    }
  })
}

// Routines are started as `const future = routine(generatorFunction(...args))`
// and canceled as `future.deinit()`
function* expensiveRoutine(...args) {
  const value = yield expensiveWork(...args)
  return value
}
```

Lack of implicit cancelation leads to incorrect behavior. The client may wish to
abort the work it has started; smart clients may cancel unnecessary requests to
avoid wasting resources; and so on. Worse, this makes Node.js and Go servers
uniquely vulnerable to a certain type of DoS attack: making the server start
expensive work and immediately canceling the request to free the attacker's
system resources, while the server keeps slogging.

Fortunately, we can fix this. We have the technology for implicit ownerhip and
cancelation in async operations
([Posterus](https://github.com/Mitranim/posterus)).

## API

In Koa, every request handler acts as middleware: it controls the execution of
the next handler, running code before and after it.

In `koa-ring`, these are separate concepts. A _middleware_ function creates a
_request handler_ function by wrapping the next handler.

```js
// Response format. Status and headers are optional
const response = {status: 200, headers: {}, body: 'Hello world!'}

const handler = request => response

const overwritingMiddleware = nextHandler => async request => {
  const ignoredResponse = await nextHandler(request)
  return response
}

const noopMiddleware = nextHandler => nextHandler

const endware = () => handler
```

The resulting handlers have a signature of `ƒ(request) -> response` and lend
themselves to composition and functional transformations of requests/responses.

`koa-ring` helps you [compose](#compose) middlewares, [mount](#mount) them on
routes, [pattern-match](#match) on request structure, and finally adapt them
[to Koa middleware](#tokoamiddleware) to plug into Koa.

### Request

Every handler is a `ƒ(request) -> response`. By default, it passes the Koa
request (see [reference](http://koajs.com/#request)). Handlers pass requests
to each other:

```js
function middleware(nextHandler) {
  return function handler(request) {
    return nextHandler(request)
  }
}
```

When overriding request fields (for instance, when mounting on a different URL
or adding new fields), use `Object.create`:

```js
const middleware = next => request => next(Object.create(request, {
  url: {value: request.url.replace(/^api/, '')}
}))
```

This is much better than mutating or copying the request object. Copying is
especially discouraged, as it's likely to lose important fields stored on the
prototype chain.

### Response

Every handler may return a response. Responses are plain dicts with the
following format:

```js
type Response = {status: number, headers: {}, body: any}
```

Every field is optional. It's ok to return nothing; `koa-ring` will just run the
next Koa middleware.

Handlers may override each other's responses:

```js
const middleware = next => async request => {
  const response = await next(request)
  return response || {status: 404}
}
```

### `compose`

Combines multiple middlewares into one middleware that will invoke them
left-to-right.

```js
const {compose} = require('koa-ring')

const first = next => request => {
  request = Object.create(request, {body: {value: 'overwritten request body'}})
  return next(request)
}

const second = () => request => ({body: request.body})

const middleware = compose([first, second])
```

### `toKoaMiddleware`

Adapts a `koa-ring` middleware to be plugged into Koa. You should compose your
middlewares into one, then invoke `toKoaMiddleware` once per application.

```js
const Koa = require('koa')
const {toKoaMiddleware} = require('koa-ring')

const app = new Koa()

// Adds `request.body`
app.use(require('koa-bodyparser')())

const echo = request => request

const echoMiddleware = () => echo

app.use(toKoaMiddleware(echoMiddleware))
```

### `mount`

Routing tool. Creates a middleware mounted on a subpath. The matched part is
subtracted from `request.url`.

```js
const {mount, compose} = require('koa-ring')

const middleware = mount('api', next => request => {
  console.log(request.url)  // 'api' has been stripped off
})

// Typical setup
const apiMiddleware = mount('api', compose([
  require('./some-endpoint'),
  require('./another-endpoint'),
  // ...
]))
```

Paths can be strings:

```js
mount('api/some/endpoint', middleware)
```

Paths can be lists that act as loose patterns (see
[`fpx.testBy`](https://mitranim.com/fpx/#-testby-pattern-value-)):

```js
mount(['api', /some/, x => x === 'endpoint'], middleware)
```

### `match`

Pattern matching tool. Creates a middleware whose handler runs only when the
request matches the provided pattern. Uses
[`fpx.testBy`](https://mitranim.com/fpx/#-testby-pattern-value-).

When the pattern doesn't match, this runs the next handler.

```js
const {match} = require('koa-ring')

const filtered = match({url: /^api[/]echo/, method: 'POST'}, middleware)
```

### Futures

See [motivation](#cancelation) for futures support.

To use `koa-ring` with Posterus futures and coroutines, use `toKoaMiddleware`
from the optional `koa-ring/posterus` module.

```js
const Koa = require('koa')
const {compose} = require('koa-ring')
const {toKoaMiddleware} = require('koa-ring/posterus')

const app = new Koa()

const middleware = next => function* handler(request) {
  const response = yield next(request)
  return response
}

app.use(toKoaMiddleware(compose([
  // ...
  middleware,
  // ...
])))
```
