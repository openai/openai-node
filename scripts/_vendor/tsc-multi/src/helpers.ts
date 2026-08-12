export const helpers: Record<
  string,
  {
    deps: string[];
    code: string;
  }
> = {
  __addDisposableResource: {
    deps: [],
    code: 'function __addDisposableResource(env, value, async) {\n  if (value !== null && value !== void 0) {\n    if (typeof value !== "object" && typeof value !== "function") throw new TypeError("Object expected.");\n    var dispose, inner;\n    if (async) {\n      if (!Symbol.asyncDispose) throw new TypeError("Symbol.asyncDispose is not defined.");\n      dispose = value[Symbol.asyncDispose];\n    }\n    if (dispose === void 0) {\n      if (!Symbol.dispose) throw new TypeError("Symbol.dispose is not defined.");\n      dispose = value[Symbol.dispose];\n      if (async) inner = dispose;\n    }\n    if (typeof dispose !== "function") throw new TypeError("Object not disposable.");\n    if (inner)\n      dispose = function () {\n        try {\n          inner.call(this);\n        } catch (e) {\n          return Promise.reject(e);\n        }\n      };\n    env.stack.push({ value, dispose, async });\n  } else if (async) {\n    env.stack.push({ async: true });\n  }\n  return value;\n}',
  },
  __assign: {
    deps: [],
    code: 'var __assign = function () {\n  __assign =\n    Object.assign ||\n    function __assign2(t) {\n      for (var s, i = 1, n = arguments.length; i < n; i++) {\n        s = arguments[i];\n        for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p)) t[p] = s[p];\n      }\n      return t;\n    };\n  return __assign.apply(this, arguments);\n};',
  },
  __asyncDelegator: {
    deps: ['__await'],
    code: 'function __asyncDelegator(o) {\n  var i, p;\n  return (\n    (i = {}),\n    verb("next"),\n    verb("throw", function (e) {\n      throw e;\n    }),\n    verb("return"),\n    (i[Symbol.iterator] = function () {\n      return this;\n    }),\n    i\n  );\n  function verb(n, f) {\n    i[n] = o[n]\n      ? function (v) {\n          return (p = !p) ? { value: __await(o[n](v)), done: false } : f ? f(v) : v;\n        }\n      : f;\n  }\n}',
  },
  __asyncGenerator: {
    deps: ['__await'],
    code: 'function __asyncGenerator(thisArg, _arguments, generator) {\n  if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");\n  var g = generator.apply(thisArg, _arguments || []),\n    i,\n    q = [];\n  return (\n    (i = Object.create((typeof AsyncIterator === "function" ? AsyncIterator : Object).prototype)),\n    verb("next"),\n    verb("throw"),\n    verb("return", awaitReturn),\n    (i[Symbol.asyncIterator] = function () {\n      return this;\n    }),\n    i\n  );\n  function awaitReturn(f) {\n    return function (v) {\n      return Promise.resolve(v).then(f, reject);\n    };\n  }\n  function verb(n, f) {\n    if (g[n]) {\n      i[n] = function (v) {\n        return new Promise(function (a, b) {\n          q.push([n, v, a, b]) > 1 || resume(n, v);\n        });\n      };\n      if (f) i[n] = f(i[n]);\n    }\n  }\n  function resume(n, v) {\n    try {\n      step(g[n](v));\n    } catch (e) {\n      settle(q[0][3], e);\n    }\n  }\n  function step(r) {\n    r.value instanceof __await ? Promise.resolve(r.value.v).then(fulfill, reject) : settle(q[0][2], r);\n  }\n  function fulfill(value) {\n    resume("next", value);\n  }\n  function reject(value) {\n    resume("throw", value);\n  }\n  function settle(f, v) {\n    if ((f(v), q.shift(), q.length)) resume(q[0][0], q[0][1]);\n  }\n}',
  },
  __asyncValues: {
    deps: ['__values'],
    code: 'function __asyncValues(o) {\n  if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");\n  var m = o[Symbol.asyncIterator],\n    i;\n  return m\n    ? m.call(o)\n    : ((o = typeof __values === "function" ? __values(o) : o[Symbol.iterator]()),\n      (i = {}),\n      verb("next"),\n      verb("throw"),\n      verb("return"),\n      (i[Symbol.asyncIterator] = function () {\n        return this;\n      }),\n      i);\n  function verb(n) {\n    i[n] =\n      o[n] &&\n      function (v) {\n        return new Promise(function (resolve, reject) {\n          (v = o[n](v)), settle(resolve, reject, v.done, v.value);\n        });\n      };\n  }\n  function settle(resolve, reject, d, v) {\n    Promise.resolve(v).then(function (v2) {\n      resolve({ value: v2, done: d });\n    }, reject);\n  }\n}',
  },
  __awaiter: {
    deps: [],
    code: 'function __awaiter(thisArg, _arguments, P, generator) {\n  function adopt(value) {\n    return value instanceof P\n      ? value\n      : new P(function (resolve) {\n          resolve(value);\n        });\n  }\n  return new (P || (P = Promise))(function (resolve, reject) {\n    function fulfilled(value) {\n      try {\n        step(generator.next(value));\n      } catch (e) {\n        reject(e);\n      }\n    }\n    function rejected(value) {\n      try {\n        step(generator["throw"](value));\n      } catch (e) {\n        reject(e);\n      }\n    }\n    function step(result) {\n      result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected);\n    }\n    step((generator = generator.apply(thisArg, _arguments || [])).next());\n  });\n}',
  },
  __classPrivateFieldGet: {
    deps: [],
    code: 'function __classPrivateFieldGet(receiver, state, kind, f) {\n  if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");\n  if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");\n  return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);\n}',
  },
  __classPrivateFieldIn: {
    deps: [],
    code: 'function __classPrivateFieldIn(state, receiver) {\n  if (receiver === null || (typeof receiver !== "object" && typeof receiver !== "function")) throw new TypeError("Cannot use \'in\' operator on non-object");\n  return typeof state === "function" ? receiver === state : state.has(receiver);\n}',
  },
  __classPrivateFieldSet: {
    deps: [],
    code: 'function __classPrivateFieldSet(receiver, state, value, kind, f) {\n  if (kind === "m") throw new TypeError("Private method is not writable");\n  if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter");\n  if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");\n  return kind === "a" ? f.call(receiver, value) : f ? (f.value = value) : state.set(receiver, value), value;\n}',
  },
  __decorate: {
    deps: [],
    code: 'function __decorate(decorators, target, key, desc) {\n  var c = arguments.length,\n    r = c < 3 ? target : desc === null ? (desc = Object.getOwnPropertyDescriptor(target, key)) : desc,\n    d;\n  if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);\n  else for (var i = decorators.length - 1; i >= 0; i--) if ((d = decorators[i])) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;\n  return c > 3 && r && Object.defineProperty(target, key, r), r;\n}',
  },
  __disposeResources: {
    deps: ['_SuppressedError'],
    code: 'function __disposeResources(env) {\n  function fail(e) {\n    env.error = env.hasError ? new _SuppressedError(e, env.error, "An error was suppressed during disposal.") : e;\n    env.hasError = true;\n  }\n  var r,\n    s = 0;\n  function next() {\n    while ((r = env.stack.pop())) {\n      try {\n        if (!r.async && s === 1) return (s = 0), env.stack.push(r), Promise.resolve().then(next);\n        if (r.dispose) {\n          var result = r.dispose.call(r.value);\n          if (r.async)\n            return (\n              (s |= 2),\n              Promise.resolve(result).then(next, function (e) {\n                fail(e);\n                return next();\n              })\n            );\n        } else s |= 1;\n      } catch (e) {\n        fail(e);\n      }\n    }\n    if (s === 1) return env.hasError ? Promise.reject(env.error) : Promise.resolve();\n    if (env.hasError) throw env.error;\n  }\n  return next();\n}',
  },
  __esDecorate: {
    deps: [],
    code: 'function __esDecorate(ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {\n  function accept(f) {\n    if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected");\n    return f;\n  }\n  var kind = contextIn.kind,\n    key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";\n  var target = !descriptorIn && ctor ? (contextIn["static"] ? ctor : ctor.prototype) : null;\n  var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});\n  var _,\n    done = false;\n  for (var i = decorators.length - 1; i >= 0; i--) {\n    var context = {};\n    for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];\n    for (var p in contextIn.access) context.access[p] = contextIn.access[p];\n    context.addInitializer = function (f) {\n      if (done) throw new TypeError("Cannot add initializers after decoration has completed");\n      extraInitializers.push(accept(f || null));\n    };\n    var result = (0, decorators[i])(kind === "accessor" ? { get: descriptor.get, set: descriptor.set } : descriptor[key], context);\n    if (kind === "accessor") {\n      if (result === void 0) continue;\n      if (result === null || typeof result !== "object") throw new TypeError("Object expected");\n      if ((_ = accept(result.get))) descriptor.get = _;\n      if ((_ = accept(result.set))) descriptor.set = _;\n      if ((_ = accept(result.init))) initializers.unshift(_);\n    } else if ((_ = accept(result))) {\n      if (kind === "field") initializers.unshift(_);\n      else descriptor[key] = _;\n    }\n  }\n  if (target) Object.defineProperty(target, contextIn.name, descriptor);\n  done = true;\n}',
  },
  __exportStar: {
    deps: ['__createBinding'],
    code: 'function __exportStar(m, o) {\n  for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(o, p)) __createBinding(o, m, p);\n}',
  },
  __extends: {
    deps: [],
    code: 'var extendStatics = function (d, b) {\n  extendStatics =\n    Object.setPrototypeOf ||\n    ({ __proto__: [] } instanceof Array &&\n      function (d2, b2) {\n        d2.__proto__ = b2;\n      }) ||\n    function (d2, b2) {\n      for (var p in b2) if (Object.prototype.hasOwnProperty.call(b2, p)) d2[p] = b2[p];\n    };\n  return extendStatics(d, b);\n};\nfunction __extends(d, b) {\n  if (typeof b !== "function" && b !== null) throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");\n  extendStatics(d, b);\n  function __() {\n    this.constructor = d;\n  }\n  d.prototype = b === null ? Object.create(b) : ((__.prototype = b.prototype), new __());\n}',
  },
  __generator: {
    deps: [],
    code: 'function __generator(thisArg, body) {\n  var _ = {\n      label: 0,\n      sent: function () {\n        if (t[0] & 1) throw t[1];\n        return t[1];\n      },\n      trys: [],\n      ops: [],\n    },\n    f,\n    y,\n    t,\n    g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);\n  return (\n    (g.next = verb(0)),\n    (g["throw"] = verb(1)),\n    (g["return"] = verb(2)),\n    typeof Symbol === "function" &&\n      (g[Symbol.iterator] = function () {\n        return this;\n      }),\n    g\n  );\n  function verb(n) {\n    return function (v) {\n      return step([n, v]);\n    };\n  }\n  function step(op) {\n    if (f) throw new TypeError("Generator is already executing.");\n    while ((g && ((g = 0), op[0] && (_ = 0)), _))\n      try {\n        if (((f = 1), y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done)) return t;\n        if (((y = 0), t)) op = [op[0] & 2, t.value];\n        switch (op[0]) {\n          case 0:\n          case 1:\n            t = op;\n            break;\n          case 4:\n            _.label++;\n            return { value: op[1], done: false };\n          case 5:\n            _.label++;\n            y = op[1];\n            op = [0];\n            continue;\n          case 7:\n            op = _.ops.pop();\n            _.trys.pop();\n            continue;\n          default:\n            if (!((t = _.trys), (t = t.length > 0 && t[t.length - 1])) && (op[0] === 6 || op[0] === 2)) {\n              _ = 0;\n              continue;\n            }\n            if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) {\n              _.label = op[1];\n              break;\n            }\n            if (op[0] === 6 && _.label < t[1]) {\n              _.label = t[1];\n              t = op;\n              break;\n            }\n            if (t && _.label < t[2]) {\n              _.label = t[2];\n              _.ops.push(op);\n              break;\n            }\n            if (t[2]) _.ops.pop();\n            _.trys.pop();\n            continue;\n        }\n        op = body.call(thisArg, _);\n      } catch (e) {\n        op = [6, e];\n        y = 0;\n      } finally {\n        f = t = 0;\n      }\n    if (op[0] & 5) throw op[1];\n    return { value: op[0] ? op[1] : void 0, done: true };\n  }\n}',
  },
  __importDefault: {
    deps: [],
    code: 'function __importDefault(mod) {\n  return mod && mod.__esModule ? mod : { default: mod };\n}',
  },
  __importStar: {
    deps: ['__createBinding'],
    code: 'var __setModuleDefault = Object.create\n  ? function (o, v) {\n      Object.defineProperty(o, "default", { enumerable: true, value: v });\n    }\n  : function (o, v) {\n      o["default"] = v;\n    };\nvar ownKeys = function (o) {\n  ownKeys =\n    Object.getOwnPropertyNames ||\n    function (o2) {\n      var ar = [];\n      for (var k in o2) if (Object.prototype.hasOwnProperty.call(o2, k)) ar[ar.length] = k;\n      return ar;\n    };\n  return ownKeys(o);\n};\nfunction __importStar(mod) {\n  if (mod && mod.__esModule) return mod;\n  var result = {};\n  if (mod != null) {\n    for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);\n  }\n  __setModuleDefault(result, mod);\n  return result;\n}',
  },
  __makeTemplateObject: {
    deps: [],
    code: 'function __makeTemplateObject(cooked, raw) {\n  if (Object.defineProperty) {\n    Object.defineProperty(cooked, "raw", { value: raw });\n  } else {\n    cooked.raw = raw;\n  }\n  return cooked;\n}',
  },
  __metadata: {
    deps: [],
    code: 'function __metadata(metadataKey, metadataValue) {\n  if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(metadataKey, metadataValue);\n}',
  },
  __param: {
    deps: [],
    code: 'function __param(paramIndex, decorator) {\n  return function (target, key) {\n    decorator(target, key, paramIndex);\n  };\n}',
  },
  __propKey: {
    deps: [],
    code: 'function __propKey(x) {\n  return typeof x === "symbol" ? x : "".concat(x);\n}',
  },
  __rest: {
    deps: [],
    code: 'function __rest(s, e) {\n  var t = {};\n  for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0) t[p] = s[p];\n  if (s != null && typeof Object.getOwnPropertySymbols === "function")\n    for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {\n      if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i])) t[p[i]] = s[p[i]];\n    }\n  return t;\n}',
  },
  __rewriteRelativeImportExtension: {
    deps: [],
    code: 'function __rewriteRelativeImportExtension(path, preserveJsx) {\n  if (typeof path === "string" && /^\\.\\.?\\//.test(path)) {\n    return path.replace(/\\.(tsx)$|((?:\\.d)?)((?:\\.[^./]+?)?)\\.([cm]?)ts$/i, function (m, tsx, d, ext, cm) {\n      return tsx ? (preserveJsx ? ".jsx" : ".js") : d && (!ext || !cm) ? m : d + ext + "." + cm.toLowerCase() + "js";\n    });\n  }\n  return path;\n}',
  },
  __runInitializers: {
    deps: [],
    code: 'function __runInitializers(thisArg, initializers, value) {\n  var useValue = arguments.length > 2;\n  for (var i = 0; i < initializers.length; i++) {\n    value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);\n  }\n  return useValue ? value : void 0;\n}',
  },
  __setFunctionName: {
    deps: [],
    code: 'function __setFunctionName(f, name, prefix) {\n  if (typeof name === "symbol") name = name.description ? "[".concat(name.description, "]") : "";\n  return Object.defineProperty(f, "name", { configurable: true, value: prefix ? "".concat(prefix, " ", name) : name });\n}',
  },
  __spread: {
    deps: ['__read'],
    code: 'function __spread() {\n  for (var ar = [], i = 0; i < arguments.length; i++) ar = ar.concat(__read(arguments[i]));\n  return ar;\n}',
  },
  __spreadArray: {
    deps: [],
    code: 'function __spreadArray(to, from, pack) {\n  if (pack || arguments.length === 2)\n    for (var i = 0, l = from.length, ar; i < l; i++) {\n      if (ar || !(i in from)) {\n        if (!ar) ar = Array.prototype.slice.call(from, 0, i);\n        ar[i] = from[i];\n      }\n    }\n  return to.concat(ar || Array.prototype.slice.call(from));\n}',
  },
  __spreadArrays: {
    deps: [],
    code: 'function __spreadArrays() {\n  for (var s = 0, i = 0, il = arguments.length; i < il; i++) s += arguments[i].length;\n  for (var r = Array(s), k = 0, i = 0; i < il; i++) for (var a = arguments[i], j = 0, jl = a.length; j < jl; j++, k++) r[k] = a[j];\n  return r;\n}',
  },
  _SuppressedError: {
    deps: [],
    code: 'var _SuppressedError =\n  typeof SuppressedError === "function"\n    ? SuppressedError\n    : function (error, suppressed, message) {\n        var e = new Error(message);\n        return (e.name = "SuppressedError"), (e.error = error), (e.suppressed = suppressed), e;\n      };',
  },
  __read: {
    deps: [],
    code: 'function __read(o, n) {\n  var m = typeof Symbol === "function" && o[Symbol.iterator];\n  if (!m) return o;\n  var i = m.call(o),\n    r,\n    ar = [],\n    e;\n  try {\n    while ((n === void 0 || n-- > 0) && !(r = i.next()).done) ar.push(r.value);\n  } catch (error) {\n    e = { error };\n  } finally {\n    try {\n      if (r && !r.done && (m = i["return"])) m.call(i);\n    } finally {\n      if (e) throw e.error;\n    }\n  }\n  return ar;\n}',
  },
  __createBinding: {
    deps: [],
    code: 'var __createBinding = Object.create\n  ? function (o, m, k, k2) {\n      if (k2 === void 0) k2 = k;\n      var desc = Object.getOwnPropertyDescriptor(m, k);\n      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {\n        desc = {\n          enumerable: true,\n          get: function () {\n            return m[k];\n          },\n        };\n      }\n      Object.defineProperty(o, k2, desc);\n    }\n  : function (o, m, k, k2) {\n      if (k2 === void 0) k2 = k;\n      o[k2] = m[k];\n    };',
  },
  __await: {
    deps: [],
    code: 'function __await(v) {\n  return this instanceof __await ? ((this.v = v), this) : new __await(v);\n}',
  },
  __values: {
    deps: [],
    code: 'function __values(o) {\n  var s = typeof Symbol === "function" && Symbol.iterator,\n    m = s && o[s],\n    i = 0;\n  if (m) return m.call(o);\n  if (o && typeof o.length === "number")\n    return {\n      next: function () {\n        if (o && i >= o.length) o = void 0;\n        return { value: o && o[i++], done: !o };\n      },\n    };\n  throw new TypeError(s ? "Object is not iterable." : "Symbol.iterator is not defined.");\n}',
  },
};
