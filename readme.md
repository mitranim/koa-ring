## Overview

Adapter library for [Koa](http://koajs.com), a popular HTTP microframework for Node.js. Allows you to write Koa handlers as `ƒ(request) -> response`, similar to [Ring](https://github.com/ring-clojure/ring) in Clojure. See [motivation](#functional-programming).

Includes optional support for implicit cancelation via [Posterus](https://github.com/Mitranim/posterus) futures and coroutines. See [motivation](#cancelation).

## TOC

  * [Overview](#overview)
  * [TOC](#toc)
  * [Usage](#usage)
  * [Motivation](#motivation)
  * [API](#api)
    * [Request](#request)
    * [Response](#response)
    * [`toKoaMiddleware`](#tokoamiddleware)
  * [Futures](#futures)
  * [Routing](#routing)
  * [Misc](#misc)

## Usage

Shell:

```sh
npm install --exact koa-ring
```

Node:

```js
const Koa = require('koa')
const {toKoaMiddleware} = require('koa-ring')

const app = new Koa()

app.use(toKoaMiddleware(exampleMiddleware(exampleHandler)))

function exampleMiddleware(nextHandler) {
  return async function prevHandler(request) {
    // do whatever
    // can substitute request
    const req = patch(request, {})
    const response = await nextHandler(req)
    // can substitute response
    return response || {status: 404}
  }
}

function exampleHandler(request) {
  // Status and headers are optional
  return {status: 200, headers: {}, body: 'Hello world!'}
}

function patch(left, right) {
  return Object.assign({}, left, right)
}

const PORT = 9756

app.listen(PORT, err => {
  if (err) throw err
  else console.info(`Server listening on port ${PORT}`)
})
```

With cancelation support:

```js
const Koa = require('koa')
const {toKoaMiddleware} = require('koa-ring/posterus')

const app = new Koa()

app.use(toKoaMiddleware(handler))

function* handler(request) {
  // Could be a future-based database request, etc
  // This work can be automatically canceled if client disconnects
  // koa-ring automatically calls future.deinit()
  const greeting = yield Future.fromResult('Hello world!')
  return {body: greeting}
}

const PORT = 9756

app.listen(PORT, err => {
  if (err) throw err
  else console.info(`Server listening on port ${PORT}`)
})
```

See [API](#api) below.

## Motivation

### Functional Programming

In Koa, request handlers are imperative functions that take a request/response
context object, return `void` and mutate the context to send the response.

In other words, Koa is a poor match for the HTTP programming model, which lends
itself to plain functions of `ƒ(request) -> response`.

Advantages of `ƒ(request) -> response`:

  * Easy to rewrite request and/or response at handler level

  * Lends itself to function composition

  * You can often return response from another source, without writing a single line of context-mutating code

  * Returning nothing instead of a response makes it easy to signal "not found" or "noop" to the calling handler

Fortunately, we can fix this. We have the technology to write functions.

### Cancelation

JS promises lack cancelation, and are therefore fundamentally broken. Particularly unfit for user-facing programs such as servers.

On a server, you want each incoming request to own the work it starts. When the request prematurely ends, this work must be aborted.

  * In Erlang, this tends to be the default: you create subprocesses using
    `spawn_link`, they're owned by the handler process and die with it.

  * In thread-based languages, this also works as long as you don't spawn
    another thread, as there's no analog of `spawn_link`.

  * In Go, you're out of luck, as there's no support for goroutine cancelation.

  * In Node.js, you can achieve this by using cancelable async primitives, such
    as [Posterus futures](https://github.com/Mitranim/posterus), and
    [coroutines](https://github.com/Mitranim/posterus#fiber) built on them.

Concrete example:

```js
const {Future} = require('posterus')
// const {fiber} = require('posterus/fiber')

function* koaRingHandler(request) {
  // If client disconnects, this invokes onDeinit, aborting work
  const one = yield expensiveFuture(request)
  // Delegate to another fiber, implicitly owning it;
  // if the client disconnects, both routines are canceled, aborting work
  const other = yield expensiveRoutine(request)
  return {body: other}
}

// Futures can be canceled with `future.deinit()`
function expensiveFuture(...args) {
  const future = new Future()
  const operationId = expensiveOperation(...args, (error, result) => {
    future.settle(error, result)
  })
  return future.finally(function finalize(error) {
    if (error) cancelOperation(operationId)
  })
}

// Routines are started as `const future = fiber(generatorFunction(...args))`
// and canceled as `future.deinit()`
function* expensiveRoutine(...args) {
  const value = yield expensiveWork(...args)
  return value
}
```

Lack of implicit cancelation leads to incorrect behavior. The client may wish to abort the work it has started; smart clients may cancel unnecessary requests to avoid wasting resources; and so on. Worse, this makes Node.js and Go servers uniquely vulnerable to a certain type of DoS attack: making the server start expensive work and immediately canceling the request to free the attacker's system resources, while the server keeps slogging.

Fortunately, we can fix this. We have tools for implicit ownerhip and cancelation in async operations, such as [Posterus](https://github.com/Mitranim/posterus).

## API

In Koa, every request handler acts as middleware: it controls the execution of the next handler, running code before and after it.

In `koa-ring`, these are separate concepts. A _middleware_ function creates a _request handler_ function by wrapping the next handler.

```js
// Response shape. Status and headers are optional
const mockResponse = {status: 200, headers: {}, body: 'Hello world!'}

const handler = request => mockResponse

const overwritingMiddleware = nextHandler => async request => {
  const ignoredResponse = await nextHandler(request)
  return mockResponse
}

const noopMiddleware = nextHandler => nextHandler

const endware = () => handler
```

The resulting handlers have a signature of `ƒ(request) -> response` and lend themselves to composition and functional transformations of requests/responses.

`koa-ring` doesn't provide any special tools for middleware. Wrap your handlers into middlewares before passing the final handler to [`toKoaMiddleware`]((#tokoamiddleware) and then to `koa.use`.

### Request

Every handler is a function from request to response. The request is a plain JS
dict with the following shape:

```js
interface Request {
  url: string
  location: Location
  method: string
  headers: {}
  body: any
  ctx: KoaContext
  // Unimportant fields omitted
}

interface Location {
  pathname: string
  search: string
  query: {}
  // Unimportant fields omitted
}
```

`request.ctx` is the Koa context. It provides access to additional information and the underlying objects such as Node request, Node response, network socket, and so on. See the [Koa reference](http://koajs.com).

`request.location` is the parsed version of `request.url`. It's very similar to a result of Node's `require('url').parse`, but `location.query` is converted to a dict.

Unlike Koa, `koa-ring` doesn't use prototype chains. The request is a plain dict. Middleware can pass modified copies:

```js
function mountingMiddleware(nextHandler) {
  return function handler(request) {
    const url = request.url.replace(/^\/api(?=\/)/, '')
    return nextHandler(patch(request, {url}))
  }
}

function patch(left, right) {
  return Object.assign({}, left, right)
}
```

You can override both request and response:

```js
function middleware(handler) {
  return async request => {
    request = patch(request, {metadata: {}})
    let response = await handler(request)
    response = patch(response, {status: response.status || 200})
    return response
  }
}

function patch(left, right) {
  return Object.assign({}, left, right)
}
```

### Response

Handlers return responses. A response is a plain dict with the following shape:

```js
interface Response {
  status: number
  headers: {}
  body: any
}
```

Every field is optional. It's ok to return nothing; `koa-ring` will just run the next Koa middleware.

Handlers may override each other's responses:

```js
const middleware = next => async request => {
  const response = await next(request)
  return response || {status: 404}
}
```

### `toKoaMiddleware`

Adapts a `koa-ring` handler to be plugged into Koa. You should compose all your handlers and apply middlewares before passing the resulting handler to `toKoaMiddleware`. You only need one per application.

```js
const Koa = require('koa')
const {toKoaMiddleware} = require('koa-ring')

const app = new Koa()

// Adds `request.body`
app.use(require('koa-bodyparser')())

const echo = request => request

app.use(toKoaMiddleware(echo))
```

Import the future-based version from `koa-ring/posterus`:

```js
const {toKoaMiddleware} = require('koa-ring/posterus')
```

## Futures

See [motivation](#cancelation) for supporting futures.

To use `koa-ring` with Posterus futures and coroutines, some functions must be
imported from the optional `koa-ring/posterus` module.

```js
const Koa = require('koa')
const {toKoaMiddleware} = require('koa-ring/posterus')

const app = new Koa()

app.use(toKoaMiddleware(handler))

function* handler(request) {
  const response = yield someFuture(request)
  return response
}
```

## Routing

By preparsing `request.url`, `koa-ring` makes _manual_ routing much easier. You might not need a library:

```js
function mainHandler(request) {
  const {location: {pathname}} = request
  if (/^[/]api[/]/.test(pathname)) return apiHandler(request)
  return viewHandler(request)
}

function apiHandler(request) {
  const {method, location: {pathname}} = request

  if (method === 'get' && /^[/]api[/]user$/.test(pathname)) {
    return userHandler(request)
  }

  if (method === 'post' && /^[/]api[/]login$/.test(pathname)) {
    return loginHandler(request)
  }

  // ...
}
```

## Changelog

### 0.3.0

Breaking: replaced routing utils with URL preparsing. Tentative.

* removed `match`
* removed `mount`
* added `request.location`

Instead of using multiple functions hidden behind routes, you're supposed to route imperatively, with a series of `if/else`, by looking at the conveniently-parsed `request.location`.

This is tentative, likely to be followed by more changes as I'm experimenting with the idea.

## Misc

I'm receptive to suggestions. If this library _almost_ satisfies you but needs changes, open an issue or chat me up. Contacts: https://mitranim.com/#contacts
