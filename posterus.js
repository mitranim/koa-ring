'use strict'

/**
 * Version of koa-ring with support for Posterus futures and fibers,
 * as well as automatic cancelation on client disconnect.
 */

const f = require('fpx')
const {Future, isFuture} = require('posterus')
const {fiber} = require('posterus/fiber')
const u = require('./utils')

/**
 * Public
 */

exports.toKoaMiddleware = toKoaMiddleware
function toKoaMiddleware(handler) {
  return async function koaRingMiddleware(ctx, next) {
    const request = u.toPlainRequest(ctx)
    request.koaNext = next
    const future = toFuture(handler(request))

    // If the request ends prematurely, this future wins the race.
    const requestLifetime = trackRequestLifetime(ctx.req)

    // If this future loses the race, it's automatically deinited. This also
    // deinits user futures (if any), potentially avoiding unnecessary work.
    const handlerFuture = future.mapResult(function sendResponseIfRelevant(response) {
      if (u.isAwaitingResponse(ctx)) u.assignResponseToContext(ctx, response)
    })

    await Future.race([requestLifetime, handlerFuture])
  }
}

// Undocumented
exports.runKoaNext = runKoaNext
function* runKoaNext(request) {
  const {ctx, koaNext} = request || {}
  if (ctx && koaNext) {
    yield Future.fromPromise(koaNext())
    return u.toPlainResponse(ctx)
  }
  return undefined
}

/**
 * Internal
 */

function toFuture(value) {
  return (
    isFuture(value)
    ? value
    : f.isIterator(value)
    ? fiber(value)
    : f.isPromise(value)
    ? Future.fromPromise(value)
    : Future.fromResult(value)
  )
}

function trackRequestLifetime(req) {
  const future = new Future()
  req.once('close', () => future.settle())
  return future
}
