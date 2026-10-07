from django.db import transaction
from ninja import NinjaAPI, Schema
from ninja.errors import HttpError

from pits.auth import BearerAuth, make_token
from pits.models import Pit, User, Yard
from pits.rules import RuleError, assert_can_set_status, latest_ph

api = NinjaAPI(title="TanPit", urls_namespace="tanpit")
auth = BearerAuth()


class LoginIn(Schema):
    username: str
    password: str


class SampleIn(Schema):
    ph: float


class StatusIn(Schema):
    status: str


class VillageIn(Schema):
    village: str


def pit_json(pit: Pit) -> dict:
    return {
        "id": pit.id,
        "code": pit.code,
        "status": pit.status,
        "row": pit.row,
        "col": pit.col,
        "latestPh": latest_ph(pit),
        "sampleCount": pit.samples.count(),
    }


def first_yard() -> Yard:
    yard = Yard.objects.first()
    if yard is None:
        raise HttpError(404, "尚无鞣场")
    return yard


def require_admin(request) -> User:
    user = request.auth
    if user is None or user.role != "admin":
        raise HttpError(403, "仅主管可修改村名")
    return user


@api.post("/auth/login")
def login(request, payload: LoginIn):
    user = User.objects.filter(username=payload.username).first()
    if user is None or not user.check_password(payload.password):
        raise HttpError(401, "用户名或密码错误")
    return {"access_token": make_token(user.username), "user": {"username": user.username, "role": user.role}}


@api.get("/auth/me", auth=auth)
def me(request):
    user = request.auth
    return {"username": user.username, "role": user.role}


@api.get("/health")
def health(request):
    return {"status": "ok", "service": "TanPit"}


@api.get("/board", auth=auth)
def board(request):
    yard = Yard.objects.prefetch_related("pits__samples").first()
    if yard is None:
        raise HttpError(404, "尚无鞣场")
    pits = sorted(yard.pits.all(), key=lambda p: (p.row, p.col))
    return {"yard": yard.name, "village": yard.village, "pits": [pit_json(p) for p in pits]}


@api.get("/yard", auth=auth)
def yard_detail(request):
    yard = first_yard()
    # role 随接口下发，供专页决定只读还是可编辑
    return {"yard": yard.name, "village": yard.village, "role": request.auth.role}


@api.patch("/yard/village", auth=auth)
def update_village(request, payload: VillageIn):
    require_admin(request)
    village = payload.village.strip()
    if not village:
        raise HttpError(400, "村名不能为空")
    if len(village) > 120:
        raise HttpError(400, "村名最长 120 字")
    # 行锁内只写 village 一列：两名主管并发各交一名，提交顺序即生效顺序，
    # 库里最终只可能留一版；场名、坑位、酸碱读数全程不碰。
    with transaction.atomic():
        yard = Yard.objects.select_for_update().first()
        if yard is None:
            raise HttpError(404, "尚无鞣场")
        yard.village = village
        yard.save(update_fields=["village"])
    return {"yard": yard.name, "village": yard.village, "role": request.auth.role}


@api.get("/samples", auth=auth)
def sample_log(request):
    """浸液登记流水。村列取鞣场当前村名——改名后历史流水也跟新名走。"""
    yard = first_yard()
    samples = yard.pits.all().values_list(
        "code", "samples__id", "samples__ph", "samples__operator", "samples__taken_at"
    )
    rows = [
        {
            "id": sid,
            "pitCode": code,
            "village": yard.village,
            "ph": ph,
            "operator": operator or "",
            "takenAt": taken_at.isoformat(),
        }
        for code, sid, ph, operator, taken_at in samples
        if sid is not None
    ]
    rows.sort(key=lambda r: r["takenAt"], reverse=True)
    return {"yard": yard.name, "village": yard.village, "rows": rows}


@api.post("/pits/{pit_id}/samples", auth=auth)
def add_sample(request, pit_id: int, payload: SampleIn):
    pit = Pit.objects.filter(id=pit_id).first()
    if pit is None:
        raise HttpError(404, "坑不存在")
    pit.samples.create(ph=payload.ph, operator=request.auth.username)
    pit.refresh_from_db()
    return pit_json(pit)


@api.post("/pits/{pit_id}/status", auth=auth)
def set_status(request, pit_id: int, payload: StatusIn):
    pit = Pit.objects.filter(id=pit_id).first()
    if pit is None:
        raise HttpError(404, "坑不存在")
    try:
        assert_can_set_status(pit, payload.status)
    except RuleError as exc:
        raise HttpError(400, str(exc))
    pit.status = payload.status
    pit.save(update_fields=["status"])
    return pit_json(pit)
