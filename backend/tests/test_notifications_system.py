"""Notification system tests — 10 tests covering endpoints and model existence."""
import pytest

DENIED = (401, 403, 404, 429)
FAKE_ID = "00000000-0000-0000-0000-000000000099"


@pytest.mark.asyncio
async def test_notifications_list_no_auth(client):
    """GET /api/notifications without auth should be denied."""
    response = await client.get("/api/notifications")
    assert response.status_code in DENIED, f"Expected denied, got {response.status_code}"


@pytest.mark.asyncio
async def test_notifications_unread_no_auth(client):
    """GET /api/notifications/unread-count without auth should be denied."""
    response = await client.get("/api/notifications/unread-count")
    assert response.status_code in DENIED, f"Expected denied, got {response.status_code}"


@pytest.mark.asyncio
async def test_notifications_mark_read_no_auth(client):
    """POST /api/notifications/read-all without auth should be denied."""
    response = await client.post("/api/notifications/read-all")
    assert response.status_code in DENIED, f"Expected denied, got {response.status_code}"


@pytest.mark.asyncio
async def test_notifications_endpoint_exists(client):
    """GET /api/notifications should not return 404 or 405."""
    response = await client.get("/api/notifications")
    assert response.status_code not in (404, 405), f"Endpoint missing: {response.status_code}"


def test_platform_notification_model_exists():
    """PlatformNotification model should be importable."""
    from models.notification import PlatformNotification
    assert PlatformNotification is not None
    assert hasattr(PlatformNotification, "__tablename__")


def test_notification_has_required_fields():
    """PlatformNotification should have standard notification fields."""
    from models.notification import PlatformNotification
    columns = {c.name for c in PlatformNotification.__table__.columns}
    for field in ("id", "org_id", "body"):
        assert field in columns, f"Missing field: {field}"


def test_email_trigger_model_exists():
    """AppEmailTrigger model should be importable."""
    from models.app_email_trigger import AppEmailTrigger
    assert AppEmailTrigger is not None
    assert hasattr(AppEmailTrigger, "__tablename__")


def test_webhook_trigger_model_exists():
    """AppWebhookTrigger model should be importable."""
    from models.app_webhook_trigger import AppWebhookTrigger
    assert AppWebhookTrigger is not None
    assert hasattr(AppWebhookTrigger, "__tablename__")


def test_scheduled_report_model_exists():
    """AppScheduledReport model should be importable."""
    from models.app_scheduled_report import AppScheduledReport
    assert AppScheduledReport is not None
    assert hasattr(AppScheduledReport, "__tablename__")


def test_auto_assign_model_exists():
    """AppAutoAssignRule model should be importable."""
    from models.app_auto_assign_rule import AppAutoAssignRule
    assert AppAutoAssignRule is not None
    assert hasattr(AppAutoAssignRule, "__tablename__")
