'use strict'

const {isObject, isFunction, isPromise} = require('fpx')
const {Future, isFuture} = require('posterus')
const {routine} = require('posterus/routine')
const index = require('./index')
const {toPlainResponse, isAwaitingResponse, updateKoaContext, quietExtend} = index

exports.toKoaMiddleware = toKoaMiddleware
function toKoaMiddleware(handler) {
  return async function koaMiddleware(ctx, next) {
    const request = quietExtend(ctx.request, {koaNext: next})
    const future = toFuture(handler(request))
    await Future.race([
      // If this wins the race:
      //   * don't send any response
      //   * the race deinits the handler's future
      trackRequestLifetime(ctx.req),
      future.mapResult(response => {
        if (isAwaitingResponse(ctx)) updateKoaContext(ctx, response)
      }),
    ])
  }
}

exports.koaNext = koaNext
function* koaNext(request) {
  const {ctx, koaNext} = request || {}
  if (ctx && koaNext) {
    yield Future.fromPromise(koaNext())
    return toPlainResponse(ctx.response)
  }
  return undefined
}

function toFuture(value) {
  return isFuture(value)
    ? value
    : isIterator(value)
    ? routine(value)
    : isPromise(value)
    ? Future.fromPromise(value)
    : Future.fromResult(value)
}

function isIterator(value) {
  return (
    isObject(value) &&
    isFunction(value.next) &&
    isFunction(value.return) &&
    isFunction(value.throw)
  )
}

function trackRequestLifetime(req) {
  const future = new Future()
  req.once('close', () => future.settle())
  return future
}
