"""
Slack integration worker — sends messages via incoming webhooks.

Used by app_data.py to notify Slack channels after CRUD operations
on generated app data.
"""

import logging

import httpx

logger = logging.getLogger(__name__)


async def send_slack_notification(webhook_url: str, channel: str, message: str) -> bool:
    """Send a message to Slack via incoming webhook.

    Args:
        webhook_url: The Slack incoming webhook URL.
        channel: The channel to post to (e.g. "#general").
        message: The message text to send.

    Returns:
        True if the message was sent successfully, False otherwise.
    """
    try:
        async with httpx.AsyncClient() as client:
            payload = {
                "channel": channel,
                "text": message,
                "username": "isibi.ai",
                "icon_emoji": ":robot_face:",
            }
            response = await client.post(webhook_url, json=payload, timeout=10)
            if response.status_code != 200:
                logger.warning(
                    "Slack webhook failed: %s %s", response.status_code, response.text
                )
                return False
            return True
    except Exception as e:
        logger.error("Slack notification error: %s", e)
        return False
