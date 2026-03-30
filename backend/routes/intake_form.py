from __future__ import annotations

"""
Public intake form submission — no auth required.
Receives form data and sends it to the configured email via Resend.
"""

import logging
import os
from datetime import datetime, timezone
from typing import Any

import resend
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(tags=["intake-form"])

RESEND_API_KEY = os.getenv("RESEND_API_KEY", "")
FROM_EMAIL = os.getenv("FROM_EMAIL", "isibi.ai <onboarding@resend.dev>")
INTAKE_NOTIFY_EMAIL = os.getenv("INTAKE_NOTIFY_EMAIL", "aniascristian@gmail.com")


class IntakeFormData(BaseModel):
    # All fields optional since the form is multi-step
    business_name: str = ""
    tagline: str = ""
    business_description: str = ""
    services: str = ""
    service_area: str = ""
    phone: str = ""
    email: str = ""
    address: str = ""
    social_media: str = ""
    main_goal: str = ""
    visitor_action: str = ""
    has_logo: str = ""
    brand_colors: str = ""
    preferred_style: str = ""
    example_websites: str = ""
    headline: str = ""
    short_description: str = ""
    top_services: str = ""
    why_choose_us: str = ""
    benefits: str = ""
    testimonials: str = ""
    faq: str = ""
    pages_needed: Any = ""
    main_service_name: str = ""
    service_description: str = ""
    who_its_for: str = ""
    main_benefit: str = ""
    cta_text: str = ""
    has_photos: str = ""
    need_writing: str = ""
    licenses: str = ""
    awards: str = ""
    partnerships: str = ""
    reviews: str = ""
    main_button_text: str = ""
    click_to_call: str = ""
    extra_features: Any = ""
    unique_selling_point: str = ""
    must_include: str = ""
    must_exclude: str = ""
    client_name: str = ""
    client_date: str = ""


def _format_value(val: Any) -> str:
    if isinstance(val, list):
        return ", ".join(str(v) for v in val) if val else "—"
    return str(val).strip() if val else "—"


def _build_email_html(data: IntakeFormData) -> str:
    sections = [
        ("Business Information", [
            ("Business Name", data.business_name),
            ("Tagline/Slogan", data.tagline),
            ("What the business does", data.business_description),
            ("Services", data.services),
            ("Service Area", data.service_area),
            ("Phone", data.phone),
            ("Email", data.email),
            ("Address", data.address),
            ("Social Media", data.social_media),
        ]),
        ("Website Goal", [
            ("Main Goal", data.main_goal),
            ("Visitor First Action", data.visitor_action),
        ]),
        ("Branding", [
            ("Has Logo", data.has_logo),
            ("Brand Colors", data.brand_colors),
            ("Preferred Style", data.preferred_style),
            ("Example Websites", data.example_websites),
        ]),
        ("Homepage Content", [
            ("Main Headline", data.headline),
            ("Short Description", data.short_description),
            ("Top 3 Services", data.top_services),
            ("Why Choose Them", data.why_choose_us),
            ("Benefits/Features", data.benefits),
            ("Testimonials", data.testimonials),
            ("FAQ", data.faq),
        ]),
        ("Pages & Structure", [
            ("Pages Needed", data.pages_needed),
        ]),
        ("Service Details", [
            ("Main Service Name", data.main_service_name),
            ("Description", data.service_description),
            ("Target Audience", data.who_its_for),
            ("Main Benefit", data.main_benefit),
            ("CTA Text", data.cta_text),
        ]),
        ("Images & Content", [
            ("Has Photos", data.has_photos),
            ("Needs Content Writing", data.need_writing),
        ]),
        ("Trust & Credibility", [
            ("Licenses/Certifications", data.licenses),
            ("Awards", data.awards),
            ("Partnerships", data.partnerships),
            ("Reviews", data.reviews),
        ]),
        ("Call to Action", [
            ("Main Button Text", data.main_button_text),
            ("Click-to-Call", data.click_to_call),
        ]),
        ("Extra Features", [
            ("Requested Features", data.extra_features),
        ]),
        ("Final Notes", [
            ("Unique Selling Point", data.unique_selling_point),
            ("Must Include", data.must_include),
            ("Must Exclude", data.must_exclude),
            ("Client Name", data.client_name),
            ("Date", data.client_date),
        ]),
    ]

    rows_html = ""
    for section_title, fields in sections:
        rows_html += f"""
        <tr>
          <td colspan="2" style="padding:16px 0 8px;border-bottom:2px solid #ec4899">
            <h3 style="margin:0;font-size:15px;font-weight:700;color:#ec4899">{section_title}</h3>
          </td>
        </tr>"""
        for label, value in fields:
            formatted = _format_value(value)
            rows_html += f"""
        <tr>
          <td style="padding:8px 12px 8px 0;color:#888;font-size:13px;font-weight:600;vertical-align:top;width:180px;border-bottom:1px solid #f0f0f0">{label}</td>
          <td style="padding:8px 0;font-size:13px;color:#333;border-bottom:1px solid #f0f0f0;white-space:pre-wrap">{formatted}</td>
        </tr>"""

    return f"""
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:700px;margin:0 auto;padding:20px">
      <div style="background:linear-gradient(135deg,#ec4899,#8b5cf6);border-radius:12px;padding:24px;margin-bottom:24px;text-align:center">
        <h1 style="margin:0;color:white;font-size:22px;font-weight:800">New Website Intake Form</h1>
        <p style="margin:6px 0 0;color:rgba(255,255,255,.8);font-size:13px">Submitted on {datetime.now(timezone.utc).strftime('%B %d, %Y at %I:%M %p UTC')}</p>
      </div>
      <table style="width:100%;border-collapse:collapse">{rows_html}</table>
      <div style="margin-top:24px;padding:16px;background:#f8f8f8;border-radius:8px;text-align:center">
        <p style="margin:0;font-size:12px;color:#888">This form was submitted via isibi.ai/website123</p>
      </div>
    </div>
    """


@router.get("/website123", include_in_schema=False)
async def serve_intake_form():
    """Serve the standalone intake form page — no auth, no React app."""
    from fastapi.responses import HTMLResponse
    return HTMLResponse(content=_STANDALONE_HTML, status_code=200)


@router.post("/intake-form/submit")
async def submit_intake_form(data: IntakeFormData):
    """
    Receive a website intake form submission and email it.
    No authentication required — this is a public form.
    """
    if not data.business_name and not data.client_name and not data.email:
        raise HTTPException(status_code=400, detail="Please fill out at least your business name and email.")

    # Build email
    html = _build_email_html(data)
    subject = f"Website Intake Form: {data.business_name or data.client_name or 'New Submission'}"

    # Send via Resend
    if RESEND_API_KEY:
        try:
            resend.api_key = RESEND_API_KEY
            resend.Emails.send({
                "from": FROM_EMAIL,
                "to": [INTAKE_NOTIFY_EMAIL],
                "reply_to": data.email or None,
                "subject": subject,
                "html": html,
            })
            logger.info("Intake form email sent for: %s", data.business_name)
        except Exception as e:
            logger.error("Failed to send intake form email: %s", e)
            # Still return success — we don't want the user to think it failed
    else:
        logger.info("DEV MODE — Intake form received: %s", data.business_name)
        logger.info("Subject: %s", subject)

    return {"success": True, "message": "Form submitted successfully!"}


# ── Standalone HTML page ─────────────────────────────────────────────────────

_STANDALONE_HTML = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Website Intake Form</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{min-height:100vh;background:linear-gradient(135deg,#0f172a 0%,#1e1045 50%,#0f172a 100%);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;color:#f0e6ff}
.wrap{max-width:700px;margin:0 auto;padding:24px}
.logo-row{display:flex;align-items:center;gap:12px;margin-bottom:32px}
.logo{width:40px;height:40px;border-radius:10px;background:linear-gradient(135deg,#ec4899,#8b5cf6);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:18px;color:#fff}
.logo-text{font-weight:700;font-size:18px}
.logo-sub{color:rgba(240,230,255,.4);font-size:12px}
.progress{margin-bottom:32px}
.progress-top{display:flex;justify-content:space-between;margin-bottom:8px;font-size:12px;color:rgba(240,230,255,.5)}
.progress-bar{width:100%;height:4px;background:rgba(255,255,255,.08);border-radius:2px}
.progress-fill{height:100%;background:linear-gradient(90deg,#ec4899,#8b5cf6);border-radius:2px;transition:width .3s}
.card{background:rgba(255,255,255,.04);border:1px solid rgba(236,72,153,.15);border-radius:20px;padding:32px 28px;backdrop-filter:blur(16px)}
h2{font-size:22px;font-weight:700;margin-bottom:4px}
.accent-line{width:40px;height:3px;background:linear-gradient(90deg,#ec4899,#8b5cf6);border-radius:2px;margin-bottom:28px}
.field{margin-bottom:22px}
.field label{display:block;color:rgba(240,230,255,.7);font-size:13px;font-weight:600;margin-bottom:6px}
.field label .req{color:#ec4899}
input[type=text],input[type=email],input[type=tel],input[type=date],textarea{width:100%;padding:12px 14px;background:rgba(255,255,255,.03);border:1px solid rgba(236,72,153,.15);border-radius:10px;color:#f0e6ff;font-size:14px;outline:none;font-family:inherit;resize:vertical}
input:focus,textarea:focus{border-color:#ec4899;box-shadow:0 0 15px rgba(236,72,153,.15)}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chip{padding:8px 16px;border-radius:8px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.03);color:rgba(240,230,255,.6);font-size:13px;cursor:pointer;font-family:inherit;transition:all .15s}
.chip.on{border-color:#ec4899;background:rgba(236,72,153,.15);color:#ec4899}
.chip.multi.on{border-color:#8b5cf6;background:rgba(139,92,246,.15);color:#8b5cf6}
.nav{display:flex;justify-content:space-between;margin-top:24px}
.btn-back{padding:10px 24px;border-radius:10px;border:1px solid rgba(255,255,255,.1);background:transparent;color:rgba(240,230,255,.5);font-size:14px;font-weight:600;cursor:pointer;font-family:inherit}
.btn-back:disabled{opacity:.3;cursor:not-allowed}
.btn-next,.btn-submit{padding:12px 32px;border-radius:10px;border:none;background:linear-gradient(135deg,#ec4899,#8b5cf6);color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;box-shadow:0 0 20px rgba(236,72,153,.25)}
.btn-submit:disabled,.btn-next:disabled{opacity:.6}
.error{background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.3);border-radius:10px;padding:10px 14px;color:#ef4444;font-size:13px;margin-bottom:16px}
.done{display:flex;align-items:center;justify-content:center;min-height:100vh}
.done-inner{text-align:center;padding:40px}
.done-icon{width:80px;height:80px;border-radius:20px;background:linear-gradient(135deg,#22c55e,#10b981);display:flex;align-items:center;justify-content:center;margin:0 auto 24px;font-size:36px;color:#fff}
.done h1{font-size:28px;font-weight:800;margin-bottom:12px}
.done p{color:rgba(240,230,255,.6);font-size:16px;line-height:1.6}
</style>
</head>
<body>
<div id="app"></div>
<script>
const API = window.location.origin + "/api";
const SECTIONS=[
{t:"Business Information",f:[
{n:"business_name",l:"Business Name",r:1},
{n:"tagline",l:"Tagline / Slogan"},
{n:"business_description",l:"What does your business do?",ty:"ta",r:1},
{n:"services",l:"What services do you offer?",ty:"ta",r:1},
{n:"service_area",l:"Service Area (city, state, nationwide, etc.)"},
{n:"phone",l:"Phone Number",ty:"tel"},
{n:"email",l:"Email Address",ty:"email",r:1},
{n:"address",l:"Business Address"},
{n:"social_media",l:"Social Media Links",ty:"ta"}]},
{t:"Website Goal",f:[
{n:"main_goal",l:"Main goal of your website?",ty:"sel",o:["Get more calls","Generate quotes","Book appointments","Capture leads","Sell products/services","Other"],r:1},
{n:"visitor_action",l:"What should visitors do first?"}]},
{t:"Branding",f:[
{n:"has_logo",l:"Do you have a logo?",ty:"sel",o:["Yes","No","Need one designed"]},
{n:"brand_colors",l:"Brand Colors (e.g. navy blue, gold)"},
{n:"preferred_style",l:"Preferred Style",ty:"sel",o:["Modern & Clean","Bold & Colorful","Minimalist","Professional","Creative","Luxury & Elegant","Not sure"]},
{n:"example_websites",l:"Websites you like the look of?",ty:"ta"}]},
{t:"Homepage Content",f:[
{n:"headline",l:"Main Headline"},
{n:"short_description",l:"Short Description (2-3 sentences)",ty:"ta"},
{n:"top_services",l:"Your Top 3 Services",ty:"ta"},
{n:"why_choose_us",l:"Why choose your business?",ty:"ta"},
{n:"benefits",l:"Key Benefits or Features",ty:"ta"},
{n:"testimonials",l:"Customer Testimonials",ty:"ta"},
{n:"faq",l:"Frequently Asked Questions",ty:"ta"}]},
{t:"Pages Needed",f:[
{n:"pages_needed",l:"What pages do you need?",ty:"multi",o:["Home","About","Services","Contact","Blog","Portfolio","Pricing","FAQ","Testimonials","Other"]}]},
{t:"Service Details",f:[
{n:"main_service_name",l:"Your #1 Service Name"},
{n:"service_description",l:"Describe this service",ty:"ta"},
{n:"who_its_for",l:"Who is this service for?"},
{n:"main_benefit",l:"Main benefit of this service"},
{n:"cta_text",l:"Button text (e.g. 'Get a Free Quote')"}]},
{t:"Images & Content",f:[
{n:"has_photos",l:"Do you have business photos?",ty:"sel",o:["Yes","No, need stock images","Some, need more"]},
{n:"need_writing",l:"Need us to write the content?",ty:"sel",o:["Yes, write everything","I'll provide text","Some help needed"]}]},
{t:"Trust & Credibility",f:[
{n:"licenses",l:"Licenses or Certifications?"},
{n:"awards",l:"Awards or Recognitions?"},
{n:"partnerships",l:"Partnerships or Affiliations?"},
{n:"reviews",l:"Where are your reviews? (Google, Yelp)"}]},
{t:"Call to Action",f:[
{n:"main_button_text",l:"Main button text",ph:"e.g. Get Started, Call Now"},
{n:"click_to_call",l:"Click-to-call button?",ty:"sel",o:["Yes","No"]}]},
{t:"Extra Features",f:[
{n:"extra_features",l:"Extra features you want?",ty:"multi",o:["Live Chat","AI Chatbot","Online Booking","SMS Notifications","Email Newsletter","Blog","E-commerce","Customer Portal","None"]}]},
{t:"Final Notes",f:[
{n:"unique_selling_point",l:"What makes your business different?",ty:"ta"},
{n:"must_include",l:"Anything to include?",ty:"ta"},
{n:"must_exclude",l:"Anything to exclude?",ty:"ta"},
{n:"client_name",l:"Your Full Name",r:1},
{n:"client_date",l:"Today's Date",ty:"date"}]}
];

let D={},S=0,sending=false;
function val(n){return D[n]||""}
function upd(n,v){D[n]=v;}
function setChip(n,v){D[n]=v;render()}
function togMulti(n,o){let a=D[n]||[];if(a.includes(o))D[n]=a.filter(x=>x!==o);else D[n]=[...a,o];render()}

function render(){
const sec=SECTIONS[S],last=S===SECTIONS.length-1,pct=((S+1)/SECTIONS.length*100);
let h='<div class="wrap"><div class="logo-row"><div class="logo">I</div><div><div class="logo-text">Website Intake Form</div><div class="logo-sub">Fill out all sections to get started</div></div></div>';
h+='<div class="progress"><div class="progress-top"><span>Step '+(S+1)+' of '+SECTIONS.length+'</span><span>'+Math.round(pct)+'%</span></div><div class="progress-bar"><div class="progress-fill" style="width:'+pct+'%"></div></div></div>';
h+='<div class="card"><h2>'+sec.t+'</h2><div class="accent-line"></div>';
sec.f.forEach(f=>{
h+='<div class="field"><label>'+f.l+(f.r?' <span class="req">*</span>':'')+'</label>';
if(f.ty==="ta"){
h+='<textarea rows="3" placeholder="'+(f.ph||"Type your answer...")+'" oninput="upd(\''+f.n+'\',this.value)">'+val(f.n)+'</textarea>';
}else if(f.ty==="sel"){
h+='<div class="chips">';
(f.o||[]).forEach(o=>{h+='<div class="chip'+(val(f.n)===o?' on':'')+'" onclick="setChip(\''+f.n+'\',\''+o.replace(/'/g,"\\'")+'\')">'+o+'</div>';});
h+='</div>';
}else if(f.ty==="multi"){
h+='<div class="chips">';
let arr=D[f.n]||[];
(f.o||[]).forEach(o=>{h+='<div class="chip multi'+(arr.includes(o)?' on':'')+'" onclick="togMulti(\''+f.n+'\',\''+o.replace(/'/g,"\\'")+'\')">'+( arr.includes(o)?'&#10003; ':'')+o+'</div>';});
h+='</div>';
}else{
h+='<input type="'+(f.ty||"text")+'" value="'+val(f.n)+'" placeholder="'+(f.ph||"")+'" oninput="upd(\''+f.n+'\',this.value)">';
}
h+='</div>';
});
h+='<div id="err"></div>';
h+='<div class="nav"><button class="btn-back" onclick="back()"'+(S===0?' disabled':'')+'>Back</button>';
if(last)h+='<button class="btn-submit" id="sbtn" onclick="submit()">Submit Form</button>';
else h+='<button class="btn-next" onclick="next()">Next</button>';
h+='</div></div></div>';
document.getElementById("app").innerHTML=h;
}

function next(){if(S<SECTIONS.length-1){S++;render();window.scrollTo(0,0)}}
function back(){if(S>0){S--;render();window.scrollTo(0,0)}}

async function submit(){
if(sending)return;
sending=true;
var btn=document.getElementById("sbtn");
if(btn){btn.disabled=true;btn.textContent="Submitting...";}
try{
var r=await fetch(API+"/intake-form/submit",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(D)});
if(!r.ok){var e=await r.json().catch(()=>({detail:"Failed"}));throw new Error(e.detail||"Failed");}
document.getElementById("app").innerHTML='<div class="done"><div class="done-inner"><div class="done-icon">&#10003;</div><h1>Thank You!</h1><p>Your website intake form has been submitted successfully. We\'ll review your information and get back to you soon!</p></div></div>';
}catch(e){
var el=document.getElementById("err");
if(el)el.innerHTML='<div class="error">'+e.message+'</div>';
if(btn){btn.disabled=false;btn.textContent="Submit Form";}
}
sending=false;
}

render();
</script>
</body>
</html>"""
