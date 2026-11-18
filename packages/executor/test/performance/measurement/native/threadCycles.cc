#include <windows.h>
#include "node_api.h"

static decltype(&napi_create_bigint_uint64) create_bigint;
static decltype(&napi_create_uint32) create_uint32;
static decltype(&napi_create_function) create_function;
static decltype(&napi_set_named_property) set_property;
static decltype(&napi_throw_error) throw_error;

static napi_value ReadCycles(napi_env env, napi_callback_info info) {
  ULONG64 cycles = 0;
  if (!QueryThreadCycleTime(GetCurrentThread(), &cycles)) {
    throw_error(env, nullptr, "QueryThreadCycleTime failed");
    return nullptr;
  }
  napi_value result;
  if (create_bigint(env, cycles, &result) != napi_ok) {
    throw_error(env, nullptr, "Cycle counter bigint creation failed");
    return nullptr;
  }
  return result;
}

static napi_value ThreadId(napi_env env, napi_callback_info info) {
  napi_value result;
  if (create_uint32(env, GetCurrentThreadId(), &result) != napi_ok) {
    throw_error(env, nullptr, "Thread identity creation failed");
    return nullptr;
  }
  return result;
}

extern "C" __declspec(dllexport) int32_t node_api_module_get_api_version_v1() { return 8; }
extern "C" __declspec(dllexport) napi_value napi_register_module_v1(napi_env env, napi_value exports) {
  HMODULE node = GetModuleHandleW(nullptr);
  create_bigint = reinterpret_cast<decltype(create_bigint)>(GetProcAddress(node, "napi_create_bigint_uint64"));
  create_uint32 = reinterpret_cast<decltype(create_uint32)>(GetProcAddress(node, "napi_create_uint32"));
  create_function = reinterpret_cast<decltype(create_function)>(GetProcAddress(node, "napi_create_function"));
  set_property = reinterpret_cast<decltype(set_property)>(GetProcAddress(node, "napi_set_named_property"));
  throw_error = reinterpret_cast<decltype(throw_error)>(GetProcAddress(node, "napi_throw_error"));
  if (!create_bigint || !create_uint32 || !create_function || !set_property || !throw_error) return nullptr;
  napi_value cycles, identity;
  if (create_function(env, "readCycles", NAPI_AUTO_LENGTH, ReadCycles, nullptr, &cycles) != napi_ok ||
      create_function(env, "threadId", NAPI_AUTO_LENGTH, ThreadId, nullptr, &identity) != napi_ok ||
      set_property(env, exports, "readCycles", cycles) != napi_ok ||
      set_property(env, exports, "threadId", identity) != napi_ok) return nullptr;
  return exports;
}
