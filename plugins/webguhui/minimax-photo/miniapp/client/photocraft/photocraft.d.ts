/* tslint:disable */
/* eslint-disable */

export function miniapp_call(input: string): Promise<any>;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly miniapp_call: (a: number, b: number) => [number, number, number];
    readonly main: (a: number, b: number) => number;
    readonly wasm_bindgen_54f023e2846dbff4___convert__closures_____invoke___js_sys_526e9b82b0b84cf5___Function_fn_wasm_bindgen_54f023e2846dbff4___JsValue_____wasm_bindgen_54f023e2846dbff4___sys__Undefined___js_sys_526e9b82b0b84cf5___Function_fn_wasm_bindgen_54f023e2846dbff4___JsValue_____wasm_bindgen_54f023e2846dbff4___sys__Undefined_______true_: (a: number, b: number, c: any, d: any) => void;
    readonly wasm_bindgen_54f023e2846dbff4___convert__closures_____invoke___wasm_bindgen_54f023e2846dbff4___sys__JsNullable_wgpu_9990bb6ea9135c56___backend__webgpu__webgpu_sys__gen_GpuError__GpuError___core_37ee0ce0c4cd57d5___result__Result_____wasm_bindgen_54f023e2846dbff4___JsError___true_: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen_54f023e2846dbff4___convert__closures_____invoke___wasm_bindgen_54f023e2846dbff4___sys__JsNullable_wgpu_9990bb6ea9135c56___backend__webgpu__webgpu_sys__gen_GpuError__GpuError___core_37ee0ce0c4cd57d5___result__Result_____wasm_bindgen_54f023e2846dbff4___JsError___true__10: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen_54f023e2846dbff4___convert__closures_____invoke___wasm_bindgen_54f023e2846dbff4___sys__JsNullable_wgpu_9990bb6ea9135c56___backend__webgpu__webgpu_sys__gen_GpuError__GpuError___core_37ee0ce0c4cd57d5___result__Result_____wasm_bindgen_54f023e2846dbff4___JsError___true__11: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen_54f023e2846dbff4___convert__closures_____invoke___wasm_bindgen_54f023e2846dbff4___sys__JsNullable_wgpu_9990bb6ea9135c56___backend__webgpu__webgpu_sys__gen_GpuError__GpuError___core_37ee0ce0c4cd57d5___result__Result_____wasm_bindgen_54f023e2846dbff4___JsError___true__6: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen_54f023e2846dbff4___convert__closures_____invoke___core_37ee0ce0c4cd57d5___result__Result_____wasm_bindgen_54f023e2846dbff4___JsValue___true_: (a: number, b: number) => [number, number];
    readonly wasm_bindgen_54f023e2846dbff4___convert__closures_____invoke___js_sys_526e9b82b0b84cf5___Array______true_: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen_54f023e2846dbff4___convert__closures_____invoke___js_sys_526e9b82b0b84cf5___Array______true__4: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen_54f023e2846dbff4___convert__closures_____invoke___js_sys_526e9b82b0b84cf5___Array______true__5: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen_54f023e2846dbff4___convert__closures_____invoke___js_sys_526e9b82b0b84cf5___Array______true__9: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen_54f023e2846dbff4___convert__closures_____invoke___wgpu_9990bb6ea9135c56___backend__webgpu__webgpu_sys__gen_GpuDeviceLostInfo__GpuDeviceLostInfo______true_: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen_54f023e2846dbff4___convert__closures_____invoke___wgpu_9990bb6ea9135c56___backend__webgpu__webgpu_sys__gen_GpuDeviceLostInfo__GpuDeviceLostInfo______true__8: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen_54f023e2846dbff4___convert__closures_____invoke_______true_: (a: number, b: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_destroy_closure: (a: number, b: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
