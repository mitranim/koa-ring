'use strict'

const f = require('fpx')
const urlLib = require('url')
const qs = require('querystring')

/**
 * Public (undocumented)
 */

exports.toPlainRequest = toPlainRequest
function toPlainRequest(ctx) {
  const {request: {url, method, headers, body}} = ctx
  return {
    url,
    location: urlToLocation(url),
    method,
    headers,
    body,
    ctx,
    koaNext: undefined,
    // For Node.js logging
    inspect: inspectPlainRequest,
  }
}

exports.toPlainResponse = toPlainResponse
function toPlainResponse(ctx) {
  if (isAwaitingResponse(ctx)) return undefined
  const {response: {status, headers, body}} = ctx
  return {status, headers, body}
}

exports.assignResponseToContext = assignResponseToContext
function assignResponseToContext(ctx, response) {
  if (!response) return
  const {response: res} = ctx
  const {status, headers, body} = response
  if (f.isFinite(status)) res.status = status
  if (f.isObject(headers)) for (const key in headers) res.set(key, headers[key])
  if (body != null) res.body = body
}

exports.isAwaitingResponse = isAwaitingResponse
function isAwaitingResponse(ctx) {
  return ctx.status === 404 && ctx.body == null
}

exports.patch = patch
function patch() {
  return trimDict(Object.assign({}, ...arguments))
}

exports.urlToLocation = urlToLocation
function urlToLocation(url) {
  f.validate(url, f.isString)
  const parsed = urlLib.parse(url)
  return patch(parsed, {query: decodeQuery(parsed.search)})
}

exports.locationToUrl = locationToUrl
function locationToUrl(location) {
  f.validate(location, f.isDict)
  if (location.query) {
    return urlLib.format(patch(location, {
      query: undefined,
      search: encodeQuery(location.query),
    }))
  }
  return urlLib.format(location)
}

exports.decodeQuery = decodeQuery
function decodeQuery(searchString) {
  return qs.decode((searchString || '').replace(/^[?]/, ''))
}

exports.encodeQuery = encodeQuery
function encodeQuery(query) {
  return qs.encode(trimDict(query))
}

/**
 * Internal
 */

function inspectPlainRequest() {
  const request = this  // eslint-disable-line no-invalid-this
  if (request.ctx) {
    return patch(request, {ctx: '<koa context>', inspect: undefined})
  }
  return patch(request, {inspect: undefined})
}

function trimDict(value) {
  const out = {}
  if (f.isDict(value)) {
    for (const key in value) if (value[key] != null) out[key] = value[key]
  }
  return out
}
