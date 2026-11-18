#include <windows.h>
#include <node.h>
#include <v8.h>

// Diagnostic only. Per-environment state and no allocation in GC callbacks.
struct State { v8::Isolate* isolate; DWORD thread; bool enabled=false; unsigned depth=0;
  ULONG64 start=0, cycles=0, calls=0, faults=0; };
static ULONG64 Read(State* s) {
  ULONG64 n=0;
  if(GetCurrentThreadId()!=s->thread || !QueryThreadCycleTime(GetCurrentThread(),&n)) ++s->faults;
  return n;
}
static void Before(v8::Isolate*,v8::GCType,v8::GCCallbackFlags,void* data) {
  auto* s=static_cast<State*>(data); if(s->depth++==0)s->start=Read(s);
}
static void After(v8::Isolate*,v8::GCType,v8::GCCallbackFlags,void* data) {
  auto* s=static_cast<State*>(data);
  if(s->depth==0){++s->faults;return;}
  if(--s->depth==0){const auto end=Read(s); if(end<s->start)++s->faults;else s->cycles+=end-s->start; ++s->calls;}
}
static State* Get(const v8::FunctionCallbackInfo<v8::Value>& args) {
  return static_cast<State*>(args.Data().As<v8::External>()->Value());
}
static void Enable(const v8::FunctionCallbackInfo<v8::Value>& args) {
  auto* s=Get(args); if(s->enabled)return;
  s->isolate->AddGCPrologueCallback(Before,s); s->isolate->AddGCEpilogueCallback(After,s); s->enabled=true;
}
static void DisableState(State* s){
  if(!s->enabled)return;
  s->isolate->RemoveGCPrologueCallback(Before,s);s->isolate->RemoveGCEpilogueCallback(After,s);s->enabled=false;
  if(s->depth!=0)++s->faults;
}
static void Disable(const v8::FunctionCallbackInfo<v8::Value>& args){DisableState(Get(args));}
static void Snapshot(const v8::FunctionCallbackInfo<v8::Value>& args){
  auto* s=Get(args);
  if(args.Length()!=1||!args[0]->IsBigUint64Array()){
    args.GetIsolate()->ThrowException(v8::Exception::TypeError(v8::String::NewFromUtf8Literal(args.GetIsolate(),"Expected BigUint64Array(4)")));return;
  }
  const auto view=args[0].As<v8::BigUint64Array>();
  if(view->Length()!=4||view->Buffer()->WasDetached()){
    args.GetIsolate()->ThrowException(v8::Exception::TypeError(v8::String::NewFromUtf8Literal(args.GetIsolate(),"Invalid snapshot buffer")));return;
  }
  auto store=view->Buffer()->GetBackingStore();
  auto* out=reinterpret_cast<uint64_t*>(static_cast<char*>(store->Data())+view->ByteOffset());
  out[0]=Read(s);out[1]=s->cycles;out[2]=s->calls;out[3]=s->faults;
}
NODE_MODULE_INIT(){
  auto* s=new State{context->GetIsolate(),GetCurrentThreadId()};
  node::AddEnvironmentCleanupHook(s->isolate,[](void* data){auto* state=static_cast<State*>(data);DisableState(state);delete state;},s);
  const auto data=v8::External::New(s->isolate,s);
  for(const auto& item : {std::pair<const char*,v8::FunctionCallback>{"enable",Enable},{"disable",Disable},{"snapshot",Snapshot}}){
    exports->Set(context,v8::String::NewFromUtf8(s->isolate,item.first).ToLocalChecked(),
      v8::Function::New(context,item.second,data).ToLocalChecked()).Check();
  }
}
