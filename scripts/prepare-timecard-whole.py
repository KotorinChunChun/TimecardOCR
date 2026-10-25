"""公式SDKへ公開エクスポートを付け、既存の認識重みを全体OCR用tarへ再梱包する。"""
import hashlib
import io
import json
from pathlib import Path
import tarfile

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / 'www/test/timecard-ocr'
SDK_MEMBER = 'package/dist/assets/worker-entry-C9UNuyOJ.js'


def check(condition, message):
    # assert は python -O で消えるため、検証には使わない。
    if not condition:
        raise SystemExit(message)


def sdk_adapter(data):
    source = data.decode('utf-8')
    handler = 'attachWorkerMessageHandler(createPaddleOCRWorkerMessageHandler());'
    check(source.count(handler) == 1, '公式SDKの構造が変わりました。')
    ort_loader = 'Promise.resolve().then(function() {\n    return ort_bundle_min;\n  })'
    check(source.count(ort_loader) == 1, '公式SDKのORT読込部が変わりました。')
    source = source.replace(ort_loader, "import('../onnxruntime/ort.wasm.min.mjs')")
    # OpenCVの関数生成を通常のクロージャに置換し、unsafe-evalを要求しない。
    named_start = source.index('          function createNamedFunction(name, body) {')
    named_end = source.index('          function extendError(', named_start)
    source = source[:named_start] + '''          function createNamedFunction(name, body) {
            const fn = function(...args) { return body.apply(this, args); };
            Object.defineProperty(fn, 'name', {value: makeLegalFunctionName(name)});
            return fn;
          }
''' + source[named_end:]
    dyn_start = source.index('            function makeDynCaller(dynCall) {')
    dyn_end = source.index('            var fp;', dyn_start)
    source = source[:dyn_start] + '''            function makeDynCaller(dynCall) {
              const fn = function(...args) { return dynCall(rawFunction, ...args); };
              Object.defineProperty(fn, 'name', {value: 'dynCall_' + signature + '_' + rawFunction});
              Object.defineProperty(fn, 'length', {value: signature.length - 1});
              return fn;
            }
''' + source[dyn_end:]
    inv_start = source.index('          function craftInvokerFunction(')
    inv_end = source.index('          function heap32VectorToArray(', inv_start)
    source = source[:inv_start] + '''          function craftInvokerFunction(humanName, argTypes, classType, cppInvokerFunc, cppTargetFunc) {
            const count = argTypes.length - 2;
            if (count < 0) throwBindingError('argTypes array size mismatch!');
            const method = argTypes[1] !== null && classType !== null;
            const needsStack = argTypes.slice(1).some(t => t !== null && t.destructorFunction === undefined);
            const returns = argTypes[0].name !== 'void';
            const fn = function(...args) {
              if (args.length !== count) throwBindingError('function ' + humanName + ' called with ' + args.length + ' arguments, expected ' + count + ' args!');
              const destructors = needsStack ? [] : null, wired = [cppTargetFunc], converted = [];
              if (method) { const value = argTypes[1].toWireType(destructors, this); wired.push(value); converted.push([argTypes[1],value]); }
              for (let i = 0; i < count; i++) { const type = argTypes[i+2], value = type.toWireType(destructors,args[i]); wired.push(value); converted.push([type,value]); }
              const rv = cppInvokerFunc(...wired);
              if (needsStack) runDestructors(destructors);
              else for (const [type,value] of converted) if (type.destructorFunction !== null) type.destructorFunction(value);
              if (returns) return argTypes[0].fromWireType(rv);
            };
            Object.defineProperty(fn,'name',{value:makeLegalFunctionName(humanName)});
            Object.defineProperty(fn,'length',{value:count});
            return fn;
          }
''' + source[inv_end:]
    method_start = source.index('          function __emval_get_method_caller(')
    method_end = source.index('          function __emval_get_property(', method_start)
    source = source[:method_start] + '''          function __emval_get_method_caller(argCount, argTypes) {
            const types = __emval_lookupTypes(argCount,argTypes), retType = types[0];
            const caller = function(handle,name,destructors,args) {
              let offset = 0; const values = [];
              for (const type of types.slice(1)) { values.push(type.readValueFromPointer(args+offset)); offset += type.argPackAdvance; }
              const rv = handle[name](...values);
              types.slice(1).forEach((type,i) => { if(type.deleteObject) type.deleteObject(values[i]); });
              if (!retType.isVoid) return retType.toWireType(destructors,rv);
            };
            return __emval_addMethodCaller(caller);
          }
''' + source[method_end:]
    return (source.replace(handler, '// メッセージはアプリのワーカーで管理する。') +
            '\nexport {OcrPipelineRunner,sourcePayloadToMat};\n').encode('utf-8')


def recognition_archive(model, characters):
    # JSONはYAMLの部分集合。既存辞書のCTC空白と末尾ASCII空白をSDKが追加する。
    config = {'Global': {'model_name': 'PP-OCRv5_server_rec'},
              'PreProcess': {'transform_ops': [{'RecResizeImg': {'image_shape': [3, 48, 320]}}]},
              'PostProcess': {'name': 'CTCLabelDecode', 'character_dict': characters[1:-1]}}
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode='w', format=tarfile.USTAR_FORMAT) as archive:
        for name, data in [('inference.onnx', model),
                           ('inference.yml', json.dumps(config, ensure_ascii=False).encode('utf-8'))]:
            entry = tarfile.TarInfo(name)
            entry.size = len(data)
            entry.mode = 0o644
            archive.addfile(entry, io.BytesIO(data))
    return output.getvalue()


def prepare():
    raw = APP / 'models/ppocrv5-rec.onnx'
    model = raw.read_bytes()
    check(hashlib.sha256(model).hexdigest() == 'e09385400eaaaef34ceff54aeb7c4f0f1fe014c27fa8b9905d4709b65746562a', '認識モデルのハッシュが一致しません。')
    data = recognition_archive(model, json.loads((APP / 'models/characters.json').read_text(encoding='utf-8')))
    target = APP / 'models/ppocrv5-rec.tar'
    if not target.is_file() or target.read_bytes() != data:
        target.write_bytes(data)


if __name__ == '__main__':
    prepare()
