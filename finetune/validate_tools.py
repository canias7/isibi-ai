import json, urllib.request, urllib.error, time
from concurrent.futures import ThreadPoolExecutor
KEY="ak_PxTm79fVFXzgm5nQIjLI"
tools=sorted({t for c in json.load(open("catalog_connectors.json"))["connectors"].values() for t in c.get("tools",[])})
def check(tool):
    for attempt in range(4):
        req=urllib.request.Request(f"https://backend.composio.dev/api/v3/tools/execute/{tool}",method="POST",
            data=json.dumps({"user_id":"gf-noconn-test","arguments":{}}).encode(),
            headers={"x-api-key":KEY,"content-type":"application/json","User-Agent":"gf/1.0"})
        try:
            with urllib.request.urlopen(req,timeout=30) as r: return tool, r.status
        except urllib.error.HTTPError as e:
            if e.code==429: time.sleep(2**attempt); continue
            return tool, e.code
        except Exception: return tool, -1
    return tool, 429
res={}
n=0
with ThreadPoolExecutor(max_workers=8) as ex:
    for tool,code in ex.map(check, tools):
        res[tool]=code; n+=1
        if n%500==0:
            broke=sum(1 for c in res.values() if c==404)
            open("/tmp/tool_validation_progress.txt","w").write(f"{n}/{len(tools)} scanned, {broke} broken (404)\n")
broken=sorted(t for t,c in res.items() if c==404)
json.dump({"total":len(tools),"broken_404":broken,
           "ok":sum(1 for c in res.values() if c in (200,400)),
           "other":{str(c):sum(1 for x in res.values() if x==c) for c in set(res.values())}},
          open("/tmp/tool_validation.json","w"), indent=1)
print(f"DONE: {len(tools)} tools | broken(404): {len(broken)} | ok(200/400): {sum(1 for c in res.values() if c in (200,400))}")
print("status breakdown:", {c:sum(1 for x in res.values() if x==c) for c in sorted(set(res.values()))})
