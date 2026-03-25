from __future__ import annotations
from pydantic import BaseModel, EmailStr, Field
from typing import Literal


class SignupRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    first_name: str = Field(min_length=1, max_length=100)
    last_name: str = Field(min_length=1, max_length=100)
    account_type: Literal["user", "developer"] = "user"
    turnstile_token: str


class LoginRequest(BaseModel):
    email: EmailStr
    password: str
    turnstile_token: str


class VerifyEmailRequest(BaseModel):
    email: EmailStr
    code: str = Field(min_length=6, max_length=6)


class ResendCodeRequest(BaseModel):
    email: EmailStr


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    email: EmailStr
    code: str = Field(min_length=6, max_length=6)
    new_password: str = Field(min_length=8, max_length=128)


class UserResponse(BaseModel):
    id: str
    email: str
    first_name: str
    last_name: str
    account_type: str
    email_verified: bool


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse
