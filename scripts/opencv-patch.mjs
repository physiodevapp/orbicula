// Parche de OpenCV.js para que funcione con la CSP de orbicula (script-src 'self' 'wasm-unsafe-eval',
// sin 'unsafe-eval').
//
// La capa embind de Emscripten genera en tiempo de ejecución, con `new Function`, los
// «invocadores» que traducen las llamadas de JavaScript a C++. La CSP lo bloquea (EvalError) y
// OpenCV.js no llega a arrancar. Emscripten tiene una variante sin evaluación de código
// (`-s DYNAMIC_EXECUTION=0`), pero el paquete publicado no está compilado así. Este parche
// sustituye los dos puntos donde se usa `new Function` por cierres equivalentes, con la misma
// lógica que el código generado. Si el texto no aparece tal cual (otra versión), falla: no se
// sirve un OpenCV a medio parchear.

/** Invocador de funciones y métodos enlazados (createJsInvoker + su llamada en craftInvokerFunction). */
const INVOKER_FROM = 'let invokerFactory=createJsInvoker(argTypes,isClassMethodFunc,returns,isAsync);var invokerFn=invokerFactory(...closureArgs);';
const INVOKER_TO =
  'var invokerFn=function(...args){' +
  'var destructors=needsDestructorStack?[]:null;' +
  'var wired=[cppTargetFunc];' +
  'if(isClassMethodFunc){wired.push(instType.toWireType(destructors,this))}' +
  'for(var i=2;i<argCount;++i){wired.push(argTypes[i].toWireType(destructors,args[i-2]))}' +
  'var rv=cppInvokerFunc(...wired);' +
  'if(needsDestructorStack){runDestructors(destructors)}else{' +
  'for(var i=isClassMethodFunc?1:2;i<argCount;++i){if(argTypes[i].destructorFunction!==null){' +
  'argTypes[i].destructorFunction(i===1?wired[1]:wired[(isClassMethodFunc?2:1)+i-2])}}}' +
  'if(returns){return retType.fromWireType(rv)}};';

/** Invocador de métodos de valores de JavaScript desde C++ (__emval_create_invoker). */
const EMVAL_FROM = 'var invokerFunction=new Function(Object.keys(captures),functionBody)(...Object.values(captures));';
const EMVAL_TO =
  'var invokerFunction=function(handle,methodName,destructorsRef,args){' +
  'var a=argFromPtr.map((f,i)=>f(args+i*GenericWireTypeSize));var r;' +
  'switch(kind){case 0:r=Emval.toValue(handle)(...a);break;' +
  'case 2:r=new(Emval.toValue(handle))(...a);break;' +
  'case 3:r=a[a.length-1];break;' +
  'case 1:{var o=Emval.toValue(handle);r=o[getStringOrSymbol(methodName)](...a);break}}' +
  'if(!retType.isVoid){return emval_returnValue(toReturnWire,destructorsRef,r)}};';

const count = (s, sub) => s.split(sub).length - 1;

/** Devuelve el código de OpenCV.js parcheado. Lanza un error si no reconoce el original. */
export function patchOpenCv(src) {
  for (const [from, name] of [[INVOKER_FROM, 'createJsInvoker'], [EMVAL_FROM, '__emval_create_invoker']]) {
    if (count(src, from) !== 1) throw new Error(`OpenCV.js: no se reconoce el código de ${name} (¿otra versión?)`);
  }
  const out = src.replace(INVOKER_FROM, () => INVOKER_TO).replace(EMVAL_FROM, () => EMVAL_TO);
  // Lo que queda de `new Function` es la definición de createJsInvoker, que ya no se llama.
  const rest = count(out, 'new Function');
  if (rest !== 1 || count(out, 'eval(') !== 0) throw new Error(`OpenCV.js: quedan ${rest} usos de new Function o eval`);
  if (count(out, 'createJsInvoker(') !== 1) throw new Error('OpenCV.js: createJsInvoker se sigue llamando');
  return out;
}
