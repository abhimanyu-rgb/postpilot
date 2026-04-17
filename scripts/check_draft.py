"""Diagnostic: check when Draft 8 will publish."""
from datetime import datetime, timedelta, timezone
import zoneinfo
from app.backend.core.database import SessionLocal
from app.backend.models.draft import Draft
from app.backend.models.published_post import PublishedPost
from app.backend.models.integration_config import IntegrationConfig
from app.backend.models.selected_opportunity import SelectedOpportunity
from app.backend.models.campaign import Campaign

db = SessionLocal()

config = db.query(IntegrationConfig).filter(IntegrationConfig.id == 1).first()
tz = zoneinfo.ZoneInfo(config.timezone or "UTC")
now_utc = datetime.now(timezone.utc)
now_local = datetime.now(tz)

print("=== SETTINGS ===")
print(f"Timezone: {config.timezone}")
print(f"Min gap: {config.min_gap_minutes}m ({config.min_gap_minutes/60:.1f}h)")
print(f"Daily budget: {config.daily_post_budget}/day")
print(f"Now: {now_local.strftime('%Y-%m-%d %H:%M')} {config.timezone}")
print()

draft = db.query(Draft).filter(Draft.id == 8).first()
sel = db.query(SelectedOpportunity).filter(SelectedOpportunity.id == draft.selected_opportunity_id).first()
camp = db.query(Campaign).filter(Campaign.id == sel.campaign_id).first() if sel else None

print("=== DRAFT 8 ===")
print(f"Status: {draft.status}")
print(f"Campaign: {camp.name if camp else '?'}")
print(f"Window: {camp.posting_window_start} to {camp.posting_window_end}")
print()

last = db.query(PublishedPost).order_by(PublishedPost.published_at.desc()).first()
last_pub_utc = last.published_at.replace(tzinfo=timezone.utc)
gap_end_utc = last_pub_utc + timedelta(minutes=config.min_gap_minutes)
gap_end_local = gap_end_utc.astimezone(tz)

print("=== GAP CHECK ===")
print(f"Last publish: {last.published_at} UTC (Draft {last.draft_id})")
print(f"Gap ends at: {gap_end_local.strftime('%H:%M')} {config.timezone}")
gap_met = now_utc >= gap_end_utc
if gap_met:
    print(f"Gap met: YES")
else:
    wait_min = int((gap_end_utc - now_utc).total_seconds() / 60)
    print(f"Gap met: NO (wait {wait_min} more minutes)")
print()

start_h = int(camp.posting_window_start.split(":")[0])
start_m = int(camp.posting_window_start.split(":")[1])
end_h = int(camp.posting_window_end.split(":")[0])
end_m = int(camp.posting_window_end.split(":")[1])
window_start = now_local.replace(hour=start_h, minute=start_m, second=0, microsecond=0)
window_end = now_local.replace(hour=end_h, minute=end_m, second=0, microsecond=0)
in_window = window_start <= now_local <= window_end

print("=== WINDOW CHECK ===")
print(f"Window: {camp.posting_window_start}-{camp.posting_window_end} {config.timezone}")
print(f"In window: {'YES' if in_window else 'NO'} (now: {now_local.strftime('%H:%M')})")
print()

today_start = now_local.replace(hour=0, minute=0, second=0, microsecond=0)
today_start_naive = today_start.astimezone(timezone.utc).replace(tzinfo=None)
posts_today = db.query(PublishedPost).filter(PublishedPost.published_at >= today_start_naive).count()

print("=== BUDGET CHECK ===")
print(f"Posts today: {posts_today}/{config.daily_post_budget}")
print(f"Budget ok: {'YES' if posts_today < config.daily_post_budget else 'NO'}")
print()

print("=== VERDICT ===")
if not gap_met:
    if gap_end_local.hour > end_h or (gap_end_local.hour == end_h and gap_end_local.minute > end_m):
        print(f"Gap ends at {gap_end_local.strftime('%H:%M')} OUTSIDE window")
        print(f"-> Will publish TOMORROW at {camp.posting_window_start} {config.timezone}")
    else:
        print(f"Gap ends at {gap_end_local.strftime('%H:%M')} INSIDE window")
        print(f"-> Will publish TODAY at ~{gap_end_local.strftime('%H:%M')} {config.timezone}")
elif not in_window:
    if now_local.hour < start_h:
        print(f"Gap met but before window")
        print(f"-> Will publish TODAY at {camp.posting_window_start} {config.timezone}")
    else:
        print(f"Gap met but after window")
        print(f"-> Will publish TOMORROW at {camp.posting_window_start} {config.timezone}")
elif posts_today >= config.daily_post_budget:
    print(f"Budget exhausted ({posts_today}/{config.daily_post_budget})")
    print(f"-> Will publish TOMORROW at {camp.posting_window_start} {config.timezone}")
else:
    print("ALL CHECKS PASS")
    print("-> Will publish in next scheduler cycle (within 30 min)")

db.close()
