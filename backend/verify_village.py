"""村名改名验收脚本：DB_ENGINE=sqlite PYTHONPATH=. python3 verify_village.py

覆盖：空名拒存、操作工只读、主管改名不毁坑/pH/场名、楣条+流水联动、两主管并发只留一版。
用独立临时 SQLite 库，跑完即弃，不碰容器里的 Postgres。
"""
import os
import pathlib
import tempfile
import threading

os.environ["DB_ENGINE"] = "sqlite"
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

import django

django.setup()

from django.conf import settings  # noqa: E402
from django.core.management import call_command  # noqa: E402
from django.test import Client  # noqa: E402

_tmp = pathlib.Path(tempfile.mkdtemp(prefix="tanpit-verify-"))
settings.DATABASES["default"]["NAME"] = _tmp / "verify.db"
call_command("migrate", verbosity=0)

from pits.models import LiquorSample, Pit, User, Yard  # noqa: E402
from pits.seed import seed_demo  # noqa: E402

# 干净库
Yard.objects.all().delete()
User.objects.all().delete()
seed_demo()

admin = Client()
r = admin.post("/api/auth/login", data={"username": "admin", "password": "123456"}, content_type="application/json")
assert r.status_code == 200, r.content
admin_tok = r.json()["access_token"]
admin.defaults["HTTP_AUTHORIZATION"] = f"Bearer {admin_tok}"

worker = Client()
r = worker.post("/api/auth/login", data={"username": "worker", "password": "123456"}, content_type="application/json")
worker.defaults["HTTP_AUTHORIZATION"] = f"Bearer {r.json()['access_token']}"

fails = []

def check(name, cond, extra=""):
    print(("PASS" if cond else "FAIL"), name, extra)
    if not cond:
        fails.append(name)

# 1. 初始村名
r = admin.get("/api/board")
b = r.json()
check("初始村名为青皮村", b["village"] == "青皮村", b["village"])
check("场名为南冈鞣场", b["yard"] == "南冈鞣场")
pits_before = sorted((p["code"], p["status"], p["latestPh"]) for p in b["pits"])
check("初始 6 个坑", len(b["pits"]) == 6)
ph_before = sorted((s.pit.code, s.ph) for s in LiquorSample.objects.select_related("pit"))

# 2. 空名禁止（空串、纯空格）
for bad in ["", "   "]:
    r = admin.patch("/api/yard/village", data={"village": bad}, content_type="application/json")
    check(f"空名 {bad!r} 拒存 400", r.status_code == 400, str(r.status_code))
check("空名未落库", Yard.objects.get().village == "青皮村")

# 3. worker 只读：GET 可以，PATCH 403
r = worker.get("/api/yard")
check("操作工可进村名页浏览", r.status_code == 200 and r.json()["village"] == "青皮村")
r = worker.patch("/api/yard/village", data={"village": "河西村"}, content_type="application/json")
check("操作工改名被拒 403", r.status_code == 403, str(r.status_code))
check("拒后村名不变", Yard.objects.get().village == "青皮村")

# 4. 主管改名成功
r = admin.patch("/api/yard/village", data={"village": "红柳村"}, content_type="application/json")
check("主管改名 200", r.status_code == 200 and r.json()["village"] == "红柳村", r.content)

# 5. 改名不删坑、不改 pH、不改场名
yard = Yard.objects.get()
check("场名未改", yard.name == "南冈鞣场")
check("坑数仍为 6", Pit.objects.count() == 6)
ph_after = sorted((s.pit.code, s.ph) for s in LiquorSample.objects.select_related("pit"))
check("酸碱数字未变", ph_before == ph_after, f"{ph_before} vs {ph_after}")
pits_after = sorted((p["code"], p["status"], p["latestPh"]) for p in admin.get("/api/board").json()["pits"])
check("坑状态与最近读数未变", pits_before == pits_after)

# 6. 三处联动：楣条(board.village)、抽屉首行(board.village 同源)、流水村列
board = admin.get("/api/board").json()
check("楣条村名联动", board["village"] == "红柳村")
log = admin.get("/api/samples").json()
check("流水表头村名联动", log["village"] == "红柳村")
check("流水村列全部为新村名", bool(log["rows"]) and all(row["village"] == "红柳村" for row in log["rows"]))
check("流水行数与样品数一致", len(log["rows"]) == LiquorSample.objects.count())

# worker 视角也同步
check("操作工看到的楣条也是新村名", worker.get("/api/board").json()["village"] == "红柳村")
check("操作工看到的流水村列也是新村名", all(row["village"] == "红柳村" for row in worker.get("/api/samples").json()["rows"]))

# 7. 两主管并发各交一村名，库里只留一版，且各接口一致
admin2 = Client()
r = admin2.post("/api/auth/login", data={"username": "admin", "password": "123456"}, content_type="application/json")
admin2.defaults["HTTP_AUTHORIZATION"] = f"Bearer {r.json()['access_token']}"

barrier = threading.Barrier(2)
results = {}

def rename(client, name, key):
    barrier.wait()
    results[key] = client.patch("/api/yard/village", data={"village": name}, content_type="application/json")

t1 = threading.Thread(target=rename, args=(admin, "白鹭村", "a"))
t2 = threading.Thread(target=rename, args=(admin2, "青枫村", "b"))
t1.start(); t2.start(); t1.join(); t2.join()
check("两次提交都成功返回", results["a"].status_code == 200 and results["b"].status_code == 200)

final = Yard.objects.get().village
check("库里只留一版", final in {"白鹭村", "青枫村"}, final)
check("楣条与库一致", admin.get("/api/board").json()["village"] == final)
check("村名专页与库一致", admin.get("/api/yard").json()["village"] == final)
logf = admin.get("/api/samples").json()
check("流水村列与库一致", all(row["village"] == final for row in logf["rows"]) and logf["village"] == final)
check("坑位与酸碱在并发后仍未变", Pit.objects.count() == 6 and sorted((s.pit.code, s.ph) for s in LiquorSample.objects.select_related("pit")) == ph_after)

print()
print("FAILED:", fails if fails else "无 —— 全部通过")
