from ninja import NinjaAPI, Schema
from ninja.errors import HttpError

from pits.auth import BearerAuth, make_token
from pits.models import LiquorSample, Pit, User, Yard
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


def get_yard() -> Yard:
    yard = Yard.objects.first()
    if yard is None:
        raise HttpError(404, "尚无鞣场")
    return yard


def yard_json(yard: Yard) -> dict:
    return {"name": yard.name, "village": yard.village}


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
    return yard_json(get_yard())


@api.put("/yard/village", auth=auth)
def rename_village(request, payload: VillageIn):
    if request.auth.role != "admin":
        raise HttpError(403, "仅主管可改村名")
    village = payload.village.strip()
    if not village:
        raise HttpError(400, "村名不能为空")
    if len(village) > 120:
        raise HttpError(400, "村名过长")
    yard = get_yard()
    # 只动村名一列：坑位、酸碱读数、场名都不碰；单行 UPDATE 原子落库，并发抢改后库里只留一版。
    yard.village = village
    yard.save(update_fields=["village"])
    return yard_json(yard)


@api.get("/flow", auth=auth)
def flow(request):
    yard = get_yard()
    samples = (
        LiquorSample.objects.filter(pit__yard=yard)
        .select_related("pit")
        .order_by("-taken_at", "-id")[:30]
    )
    rows = [
        {
            "id": s.id,
            "pit": s.pit.code,
            "ph": s.ph,
            "operator": s.operator,
            "takenAt": s.taken_at.isoformat(),
        }
        for s in samples
    ]
    return {"rows": rows}


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
