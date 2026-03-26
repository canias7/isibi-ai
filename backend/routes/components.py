from __future__ import annotations

"""
Component Library — browse, share, and use reusable UI components.
"""

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_user_id
from db import get_db
from models.component import SharedComponent

router = APIRouter(prefix="/components", tags=["components"])


# ── Seed Components ──────────────────────────────────────────────────────────

SEED_COMPONENTS = [
    {
        "name": "Pricing Table",
        "description": "A responsive 3-tier pricing card layout with feature lists and CTA buttons. Perfect for SaaS landing pages.",
        "category": "marketing",
        "html_code": """<div class="pricing-grid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:24px;max-width:960px;margin:0 auto;padding:40px 20px;">
  <div class="pricing-card" style="border:1px solid #e2e8f0;border-radius:12px;padding:32px;text-align:center;">
    <h3 style="font-size:1.25rem;font-weight:600;margin-bottom:8px;">Starter</h3>
    <div style="font-size:2.5rem;font-weight:700;margin:16px 0;">$9<span style="font-size:1rem;color:#64748b;">/mo</span></div>
    <ul style="list-style:none;padding:0;margin:24px 0;text-align:left;">
      <li style="padding:8px 0;border-bottom:1px solid #f1f5f9;">5 Projects</li>
      <li style="padding:8px 0;border-bottom:1px solid #f1f5f9;">1GB Storage</li>
      <li style="padding:8px 0;">Email Support</li>
    </ul>
    <button style="width:100%;padding:12px;border-radius:8px;border:1px solid #3b82f6;color:#3b82f6;background:transparent;cursor:pointer;font-weight:600;">Get Started</button>
  </div>
  <div class="pricing-card" style="border:2px solid #3b82f6;border-radius:12px;padding:32px;text-align:center;position:relative;">
    <span style="position:absolute;top:-12px;left:50%;transform:translateX(-50%);background:#3b82f6;color:white;padding:4px 16px;border-radius:20px;font-size:0.75rem;font-weight:600;">POPULAR</span>
    <h3 style="font-size:1.25rem;font-weight:600;margin-bottom:8px;">Pro</h3>
    <div style="font-size:2.5rem;font-weight:700;margin:16px 0;">$29<span style="font-size:1rem;color:#64748b;">/mo</span></div>
    <ul style="list-style:none;padding:0;margin:24px 0;text-align:left;">
      <li style="padding:8px 0;border-bottom:1px solid #f1f5f9;">Unlimited Projects</li>
      <li style="padding:8px 0;border-bottom:1px solid #f1f5f9;">10GB Storage</li>
      <li style="padding:8px 0;">Priority Support</li>
    </ul>
    <button style="width:100%;padding:12px;border-radius:8px;border:none;background:#3b82f6;color:white;cursor:pointer;font-weight:600;">Get Started</button>
  </div>
  <div class="pricing-card" style="border:1px solid #e2e8f0;border-radius:12px;padding:32px;text-align:center;">
    <h3 style="font-size:1.25rem;font-weight:600;margin-bottom:8px;">Enterprise</h3>
    <div style="font-size:2.5rem;font-weight:700;margin:16px 0;">$99<span style="font-size:1rem;color:#64748b;">/mo</span></div>
    <ul style="list-style:none;padding:0;margin:24px 0;text-align:left;">
      <li style="padding:8px 0;border-bottom:1px solid #f1f5f9;">Unlimited Everything</li>
      <li style="padding:8px 0;border-bottom:1px solid #f1f5f9;">100GB Storage</li>
      <li style="padding:8px 0;">24/7 Phone Support</li>
    </ul>
    <button style="width:100%;padding:12px;border-radius:8px;border:1px solid #3b82f6;color:#3b82f6;background:transparent;cursor:pointer;font-weight:600;">Contact Sales</button>
  </div>
</div>""",
        "css_code": ".pricing-grid{font-family:system-ui,-apple-system,sans-serif;}.pricing-card:hover{box-shadow:0 4px 24px rgba(0,0,0,0.1);transform:translateY(-2px);transition:all 0.2s;}",
    },
    {
        "name": "Hero Section",
        "description": "A bold hero section with headline, subtitle, CTA button, and image placeholder. Ideal for landing pages.",
        "category": "marketing",
        "html_code": """<section class="hero-section" style="display:flex;align-items:center;justify-content:space-between;max-width:1200px;margin:0 auto;padding:80px 20px;gap:48px;">
  <div style="flex:1;">
    <h1 style="font-size:3.5rem;font-weight:800;line-height:1.1;margin-bottom:16px;color:#0f172a;">Build amazing apps without code</h1>
    <p style="font-size:1.25rem;color:#64748b;margin-bottom:32px;line-height:1.6;">Create beautiful, functional web applications in minutes. No programming experience required.</p>
    <div style="display:flex;gap:12px;">
      <button style="padding:14px 28px;border-radius:8px;border:none;background:#3b82f6;color:white;font-size:1rem;font-weight:600;cursor:pointer;">Get Started Free</button>
      <button style="padding:14px 28px;border-radius:8px;border:1px solid #e2e8f0;background:transparent;font-size:1rem;font-weight:600;cursor:pointer;color:#0f172a;">Watch Demo</button>
    </div>
  </div>
  <div style="flex:1;display:flex;justify-content:center;">
    <div style="width:100%;max-width:500px;height:350px;background:linear-gradient(135deg,#dbeafe,#e0e7ff);border-radius:16px;display:flex;align-items:center;justify-content:center;color:#6366f1;font-size:1.25rem;font-weight:600;">Image Placeholder</div>
  </div>
</section>""",
        "css_code": ".hero-section{font-family:system-ui,-apple-system,sans-serif;}@media(max-width:768px){.hero-section{flex-direction:column;text-align:center;padding:40px 20px;}.hero-section h1{font-size:2.5rem;}}",
    },
    {
        "name": "Testimonials Grid",
        "description": "A 3-column grid of testimonial cards with avatar, name, title, and quote. Great for social proof.",
        "category": "marketing",
        "html_code": """<div class="testimonials-grid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:24px;max-width:960px;margin:0 auto;padding:40px 20px;">
  <div style="background:#f8fafc;border-radius:12px;padding:24px;">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
      <div style="width:48px;height:48px;border-radius:50%;background:#3b82f6;display:flex;align-items:center;justify-content:center;color:white;font-weight:700;">JD</div>
      <div><div style="font-weight:600;">Jane Doe</div><div style="font-size:0.875rem;color:#64748b;">CEO, Acme Inc</div></div>
    </div>
    <p style="color:#334155;line-height:1.6;">"This product completely transformed our workflow. We saw a 40% increase in productivity within the first month."</p>
  </div>
  <div style="background:#f8fafc;border-radius:12px;padding:24px;">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
      <div style="width:48px;height:48px;border-radius:50%;background:#10b981;display:flex;align-items:center;justify-content:center;color:white;font-weight:700;">MS</div>
      <div><div style="font-weight:600;">Mike Smith</div><div style="font-size:0.875rem;color:#64748b;">CTO, TechCorp</div></div>
    </div>
    <p style="color:#334155;line-height:1.6;">"The best tool we've used. Setup took 5 minutes and the results speak for themselves. Highly recommended."</p>
  </div>
  <div style="background:#f8fafc;border-radius:12px;padding:24px;">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
      <div style="width:48px;height:48px;border-radius:50%;background:#f59e0b;display:flex;align-items:center;justify-content:center;color:white;font-weight:700;">SJ</div>
      <div><div style="font-weight:600;">Sarah Johnson</div><div style="font-size:0.875rem;color:#64748b;">Founder, StartupXYZ</div></div>
    </div>
    <p style="color:#334155;line-height:1.6;">"Incredible value for the price. Our team onboarded in a day and we haven't looked back since."</p>
  </div>
</div>""",
        "css_code": ".testimonials-grid{font-family:system-ui,-apple-system,sans-serif;}@media(max-width:768px){.testimonials-grid{grid-template-columns:1fr;}}",
    },
    {
        "name": "FAQ Accordion",
        "description": "An expandable FAQ section with smooth toggle animation. Click questions to reveal answers.",
        "category": "content",
        "html_code": """<div class="faq-accordion" style="max-width:720px;margin:0 auto;padding:40px 20px;">
  <h2 style="text-align:center;font-size:2rem;font-weight:700;margin-bottom:32px;color:#0f172a;">Frequently Asked Questions</h2>
  <div class="faq-item" style="border-bottom:1px solid #e2e8f0;padding:16px 0;">
    <button onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='none'?'block':'none';this.querySelector('span:last-child').textContent=this.nextElementSibling.style.display==='none'?'+':'-'" style="width:100%;display:flex;justify-content:space-between;align-items:center;background:none;border:none;cursor:pointer;padding:8px 0;font-size:1.1rem;font-weight:600;color:#0f172a;text-align:left;">
      <span>How do I get started?</span><span>+</span>
    </button>
    <div style="display:none;padding:8px 0 16px;color:#64748b;line-height:1.6;">Simply sign up for a free account, choose a template, and start customizing. No credit card required.</div>
  </div>
  <div class="faq-item" style="border-bottom:1px solid #e2e8f0;padding:16px 0;">
    <button onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='none'?'block':'none';this.querySelector('span:last-child').textContent=this.nextElementSibling.style.display==='none'?'+':'-'" style="width:100%;display:flex;justify-content:space-between;align-items:center;background:none;border:none;cursor:pointer;padding:8px 0;font-size:1.1rem;font-weight:600;color:#0f172a;text-align:left;">
      <span>Can I cancel anytime?</span><span>+</span>
    </button>
    <div style="display:none;padding:8px 0 16px;color:#64748b;line-height:1.6;">Yes! You can cancel your subscription at any time. No questions asked, no hidden fees.</div>
  </div>
  <div class="faq-item" style="border-bottom:1px solid #e2e8f0;padding:16px 0;">
    <button onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='none'?'block':'none';this.querySelector('span:last-child').textContent=this.nextElementSibling.style.display==='none'?'+':'-'" style="width:100%;display:flex;justify-content:space-between;align-items:center;background:none;border:none;cursor:pointer;padding:8px 0;font-size:1.1rem;font-weight:600;color:#0f172a;text-align:left;">
      <span>Do you offer custom plans?</span><span>+</span>
    </button>
    <div style="display:none;padding:8px 0 16px;color:#64748b;line-height:1.6;">Absolutely! Contact our sales team for enterprise pricing and custom feature requests tailored to your needs.</div>
  </div>
  <div class="faq-item" style="border-bottom:1px solid #e2e8f0;padding:16px 0;">
    <button onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='none'?'block':'none';this.querySelector('span:last-child').textContent=this.nextElementSibling.style.display==='none'?'+':'-'" style="width:100%;display:flex;justify-content:space-between;align-items:center;background:none;border:none;cursor:pointer;padding:8px 0;font-size:1.1rem;font-weight:600;color:#0f172a;text-align:left;">
      <span>Is my data secure?</span><span>+</span>
    </button>
    <div style="display:none;padding:8px 0 16px;color:#64748b;line-height:1.6;">We use industry-standard encryption and security practices. Your data is encrypted at rest and in transit.</div>
  </div>
</div>""",
        "css_code": ".faq-accordion{font-family:system-ui,-apple-system,sans-serif;}.faq-item button:hover{color:#3b82f6;}",
    },
]


# ── Schemas ───────────────────────────────────────────────────────────────────

class ComponentCreateBody(BaseModel):
    name: str
    description: Optional[str] = None
    category: Optional[str] = None
    html_code: str
    css_code: Optional[str] = None
    preview_image_url: Optional[str] = None
    is_public: bool = True


def _serialize(c: SharedComponent) -> dict:
    return {
        "id": str(c.id),
        "name": c.name,
        "description": c.description,
        "category": c.category,
        "author_id": str(c.author_id) if c.author_id else None,
        "html_code": c.html_code,
        "css_code": c.css_code,
        "preview_image_url": c.preview_image_url,
        "use_count": c.use_count,
        "is_public": c.is_public,
        "created_at": c.created_at.isoformat() if c.created_at else None,
        "updated_at": c.updated_at.isoformat() if c.updated_at else None,
    }


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("")
async def list_components(
    category: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    sort: str = Query("popular", pattern="^(popular|newest|name)$"),
    db: AsyncSession = Depends(get_db),
):
    """List shared components."""
    query = select(SharedComponent).where(SharedComponent.is_public.is_(True))

    if category:
        query = query.where(SharedComponent.category == category)
    if search:
        term = f"%{search}%"
        query = query.where(
            or_(SharedComponent.name.ilike(term), SharedComponent.description.ilike(term))
        )

    if sort == "popular":
        query = query.order_by(SharedComponent.use_count.desc())
    elif sort == "newest":
        query = query.order_by(SharedComponent.created_at.desc())
    elif sort == "name":
        query = query.order_by(SharedComponent.name.asc())

    result = await db.execute(query)
    components = result.scalars().all()

    return {"components": [_serialize(c) for c in components]}


@router.get("/{component_id}")
async def get_component(
    component_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Get component detail with code."""
    result = await db.execute(
        select(SharedComponent).where(SharedComponent.id == uuid.UUID(component_id))
    )
    component = result.scalar_one_or_none()
    if not component:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Component not found")
    return _serialize(component)


@router.post("", status_code=201)
async def create_component(
    body: ComponentCreateBody,
    user_id: uuid.UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Create/share a component."""
    component = SharedComponent(
        name=body.name,
        description=body.description,
        category=body.category,
        author_id=user_id,
        html_code=body.html_code,
        css_code=body.css_code,
        preview_image_url=body.preview_image_url,
        is_public=body.is_public,
    )
    db.add(component)
    await db.commit()
    await db.refresh(component)
    return _serialize(component)


@router.delete("/{component_id}", status_code=200)
async def delete_component(
    component_id: str,
    user_id: uuid.UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Delete a component (owner only)."""
    result = await db.execute(
        select(SharedComponent).where(SharedComponent.id == uuid.UUID(component_id))
    )
    component = result.scalar_one_or_none()
    if not component:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Component not found")
    if component.author_id != user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the owner can delete this component")

    await db.delete(component)
    await db.commit()
    return {"detail": "Component deleted"}


@router.post("/{component_id}/use")
async def use_component(
    component_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Increment use count and return the component code."""
    result = await db.execute(
        select(SharedComponent).where(SharedComponent.id == uuid.UUID(component_id))
    )
    component = result.scalar_one_or_none()
    if not component:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Component not found")

    component.use_count = (component.use_count or 0) + 1
    await db.commit()
    await db.refresh(component)

    return {
        "id": str(component.id),
        "name": component.name,
        "html_code": component.html_code,
        "css_code": component.css_code,
        "use_count": component.use_count,
    }
