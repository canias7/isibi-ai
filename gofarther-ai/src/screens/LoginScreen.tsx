import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView,
  Platform, Alert, ActivityIndicator, ScrollView, Animated, Keyboard,
  TouchableWithoutFeedback, Linking, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import { C } from '../lib/theme';
import { login, login2FA, signup, socialLogin, forgotPassword, resetPassword, verifyEmail, resendVerification } from '../lib/api';

WebBrowser.maybeCompleteAuthSession();

const GOOGLE_CLIENT_ID_WEB = '321209982665-uboadljp5d0hl426rrntnnmg8c6l5v2f.apps.googleusercontent.com';
const GOOGLE_CLIENT_ID_IOS = '321209982665-agd7dabtpq1jujo8fqsf6j7o70hva44b.apps.googleusercontent.com';
const { width: SW } = Dimensions.get('window');

const PHRASES = [
  { text: 'GoFarther', highlight: 'AI' },
  { text: 'Send an', highlight: 'email' },
  { text: 'Make a', highlight: 'call' },
  { text: 'Get', highlight: 'directions' },
  { text: 'Manage your', highlight: 'tasks' },
  { text: 'Talk to your', highlight: 'agent' },
  { text: 'Search the', highlight: 'web' },
  { text: "Let's", highlight: 'go' },
];

export default function LoginScreen({ onLogin }: { onLogin: () => void }) {
  const [mode, setMode] = useState<'welcome' | 'email-login' | 'email-signup' | 'forgot' | 'reset' | '2fa' | 'verify-email'>('welcome');
  const [verifyCode, setVerifyCode] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [tempToken, setTempToken] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [focusedField, setFocusedField] = useState('');
  const [phraseIdx, setPhraseIdx] = useState(0);
  const [challengeRequired, setChallengeRequired] = useState(false);
  const [challengeQuestion, setChallengeQuestion] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [challengeAnswer, setChallengeAnswer] = useState('');

  // Animations
  const phraseOpacity = useRef(new Animated.Value(1)).current;
  const phraseSlide = useRef(new Animated.Value(0)).current;
  const panelSlide = useRef(new Animated.Value(1)).current;
  const contentFade = useRef(new Animated.Value(0)).current;
  const orbGlow = useRef(new Animated.Value(0.4)).current;
  const orbScale = useRef(new Animated.Value(1)).current;

  // Rotating text
  useEffect(() => {
    const timer = setInterval(() => {
      Animated.parallel([
        Animated.timing(phraseOpacity, { toValue: 0, duration: 250, useNativeDriver: true }),
        Animated.timing(phraseSlide, { toValue: -24, duration: 250, useNativeDriver: true }),
      ]).start(() => {
        setPhraseIdx(p => (p + 1) % PHRASES.length);
        phraseSlide.setValue(24);
        Animated.parallel([
          Animated.timing(phraseOpacity, { toValue: 1, duration: 350, useNativeDriver: true }),
          Animated.timing(phraseSlide, { toValue: 0, duration: 350, useNativeDriver: true }),
        ]).start();
      });
    }, 2400);
    return () => clearInterval(timer);
  }, []);

  // Entry
  useEffect(() => {
    Animated.parallel([
      Animated.timing(contentFade, { toValue: 1, duration: 700, useNativeDriver: true }),
      Animated.spring(panelSlide, { toValue: 0, useNativeDriver: true, tension: 40, friction: 10 }),
    ]).start();

    Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(orbGlow, { toValue: 0.7, duration: 2000, useNativeDriver: true }),
          Animated.timing(orbScale, { toValue: 1.12, duration: 2000, useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(orbGlow, { toValue: 0.4, duration: 2000, useNativeDriver: true }),
          Animated.timing(orbScale, { toValue: 1, duration: 2000, useNativeDriver: true }),
        ]),
      ])
    ).start();
  }, []);

  const transitionFade = useRef(new Animated.Value(1)).current;
  const switchMode = (newMode: typeof mode) => {
    Animated.timing(transitionFade, { toValue: 0, duration: 150, useNativeDriver: true }).start(() => {
      setMode(newMode);
      Animated.timing(transitionFade, { toValue: 1, duration: 300, useNativeDriver: true }).start();
    });
  };

  useEffect(() => {
    AppleAuthentication.isAvailableAsync().then(setAppleAvailable).catch(() => setAppleAvailable(false));
  }, []);

  const [googleRequest, googleResponse, googlePromptAsync] = Google.useAuthRequest({
    webClientId: GOOGLE_CLIENT_ID_WEB,
    iosClientId: GOOGLE_CLIENT_ID_IOS,
    // Always show the Google account picker so users can switch accounts
    // after logout — by default Google silently reuses the cached session.
    extraParams: { prompt: 'select_account' },
  });

  useEffect(() => {
    if (googleResponse?.type === 'success') {
      handleGoogleAuth(googleResponse.authentication?.accessToken || '');
    }
  }, [googleResponse]);

  const handleGoogleAuth = async (accessToken: string) => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const res = await fetch('https://www.googleapis.com/userinfo/v2/me', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const user = await res.json();
      await socialLogin(user.email, user.name || user.given_name || 'User', 'google', accessToken);
      onLogin();
    } catch (e: any) {
      Alert.alert('Sign in failed', e.message || 'Google sign-in failed');
    } finally { setLoading(false); }
  };

  const handleAppleAuth = async () => {
    setLoading(true);
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      const appleEmail = credential.email || '';
      const appleName = credential.fullName
        ? `${credential.fullName.givenName || ''} ${credential.fullName.familyName || ''}`.trim()
        : 'Apple User';

      // iOS only allows one Apple ID per device, so Apple Sign-In will
      // always re-auth the same Apple ID silently after the first consent.
      // Show an explicit confirmation so the user can bail out and pick a
      // different sign-in method (or log in to a different GoFarther
      // account via email + password).
      const confirmed = await new Promise<boolean>((resolve) => {
        Alert.alert(
          'Continue with Apple?',
          appleEmail
            ? `Sign in to GoFarther AI as ${appleEmail}?`
            : 'Sign in to GoFarther AI with your Apple ID?',
          [
            { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
            { text: 'Continue', onPress: () => resolve(true) },
          ],
          { cancelable: true, onDismiss: () => resolve(false) },
        );
      });
      if (!confirmed) { setLoading(false); return; }

      await socialLogin(appleEmail, appleName, 'apple', credential.identityToken || '');
      onLogin();
    } catch (e: any) {
      if (e.code !== 'ERR_REQUEST_CANCELED') {
        Alert.alert('Sign in failed', e.message || 'Apple sign-in failed');
      }
    } finally { setLoading(false); }
  };

  const isValidEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

  const handleEmailLogin = async () => {
    if (!email || !password) { Alert.alert('Missing fields', 'Please enter your email and password'); return; }
    if (!isValidEmail(email)) { Alert.alert('Invalid email', 'Please enter a valid email address'); return; }
    setLoading(true);
    try {
      const data = await login(
        email.toLowerCase().trim(),
        password,
        challengeRequired ? challengeId : undefined,
        challengeRequired ? challengeAnswer : undefined,
      );
      // Challenge required — show challenge UI
      if (data.requires_challenge) {
        setChallengeRequired(true);
        setChallengeQuestion(data.challenge_question || 'Solve the challenge to continue');
        setChallengeId(data.challenge_id || '');
        setChallengeAnswer('');
        setLoading(false);
        return;
      }
      if (data.requires_2fa) {
        setTempToken(data.temp_token);
        setChallengeRequired(false);
        setLoading(false);
        switchMode('2fa');
        return;
      }
      setChallengeRequired(false);
      onLogin();
    } catch (e: any) { Alert.alert('Login failed', e.message || 'Check your credentials and try again'); }
    finally { setLoading(false); }
  };

  const handle2FALogin = async () => {
    if (!totpCode || totpCode.length !== 6) { Alert.alert('Enter code', 'Please enter the 6-digit code from your authenticator app'); return; }
    setLoading(true);
    try {
      await login2FA(tempToken, totpCode);
      onLogin();
    } catch (e: any) { Alert.alert('2FA failed', e.message || 'Invalid code. Try again.'); }
    finally { setLoading(false); setTotpCode(''); }
  };

  const handleEmailSignup = async () => {
    if (!name || !email || !password) { Alert.alert('Missing fields', 'Please fill in all fields'); return; }
    if (!isValidEmail(email)) { Alert.alert('Invalid email', 'Please enter a valid email address'); return; }
    if (password.length < 12) { Alert.alert('Weak password', 'Password must be at least 12 characters with uppercase, lowercase, number, and special character'); return; }
    setLoading(true);
    try {
      await signup(email.toLowerCase().trim(), name.trim(), password);
      // Don't log in yet — require email verification first.
      switchMode('verify-email');
    } catch (e: any) { Alert.alert('Signup failed', e.message || 'Something went wrong'); }
    finally { setLoading(false); }
  };

  const handleVerifyEmail = async () => {
    const code = verifyCode.trim().toUpperCase();
    if (!code) { Alert.alert('Enter code', 'Please enter the code from your email'); return; }
    setLoading(true);
    try {
      await verifyEmail(email.toLowerCase().trim(), code);
      setVerifyCode('');
      onLogin();
    } catch (e: any) { Alert.alert('Verification failed', e.message || 'Invalid or expired code'); }
    finally { setLoading(false); }
  };

  const handleResendVerification = async () => {
    if (!email) return;
    try {
      await resendVerification(email.toLowerCase().trim());
      Alert.alert('Code sent', 'Check your email for a new verification code');
    } catch (e: any) { Alert.alert('Could not resend', e.message || 'Try again in a moment'); }
  };

  const handleForgotPassword = async () => {
    if (!email || !isValidEmail(email)) { Alert.alert('Enter email', 'Please enter your email address first'); return; }
    setLoading(true);
    try {
      await forgotPassword(email.toLowerCase().trim());
      Alert.alert('Code sent', 'Check your email for the reset code');
      switchMode('reset');
    } catch (e: any) { Alert.alert('Error', e.message || 'Could not send reset code'); }
    finally { setLoading(false); }
  };

  const handleResetPassword = async () => {
    if (!resetCode || !newPassword) { Alert.alert('Missing fields', 'Enter the code and new password'); return; }
    if (newPassword.length < 12) { Alert.alert('Weak password', 'Password must be at least 12 characters with uppercase, lowercase, number, and special character'); return; }
    setLoading(true);
    try {
      await resetPassword(email.toLowerCase().trim(), resetCode.trim(), newPassword);
      Alert.alert('Password reset', 'You can now log in with your new password');
      switchMode('email-login');
      setResetCode('');
      setNewPassword('');
    } catch (e: any) { Alert.alert('Error', e.message || 'Reset failed'); }
    finally { setLoading(false); }
  };

  // ==================== LOADING ====================
  if (loading) {
    return (
      <View style={s.loadingWrap}>
        <Animated.View style={[s.loadingOrbOuter, { transform: [{ scale: orbScale }], opacity: orbGlow }]} />
        <View style={s.loadingOrbInner} />
        <Text style={s.loadingText}>Signing in...</Text>
        <Text style={s.loadingHint}>First login may take a moment</Text>
      </View>
    );
  }

  // ==================== WELCOME ====================
  if (mode === 'welcome') {
    const panelY = panelSlide.interpolate({ inputRange: [0, 1], outputRange: [0, 350] });
    const phrase = PHRASES[phraseIdx];

    return (
      <View style={s.root}>
        {/* Top white area — rotating phrases */}
        <Animated.View style={[s.whiteArea, { opacity: contentFade }]}>
          <View style={s.phraseRow}>
            <Animated.View style={{ opacity: phraseOpacity, transform: [{ translateY: phraseSlide }], flexDirection: 'row', alignItems: 'center' }}>
              <Text style={s.phraseNormal}>{phrase.text} </Text>
              <Text style={s.phraseHighlight}>{phrase.highlight}</Text>
            </Animated.View>
            {/* Glowing orb next to text */}
            <Animated.View style={[s.orbDot, { transform: [{ scale: orbScale }] }]}>
              <View style={s.orbDotInner} />
            </Animated.View>
          </View>
        </Animated.View>

        {/* Bottom panel */}
        <Animated.View style={[s.bottomPanel, { transform: [{ translateY: panelY }] }]}>
          <SafeAreaView edges={['bottom']} style={s.panelContent}>
            {/* Apple */}
            {appleAvailable && (
              <TouchableOpacity style={s.btnApple} onPress={handleAppleAuth} activeOpacity={0.8}>
                <Text style={s.appleIcon}>{'\uF8FF'}</Text>
                <Text style={s.btnAppleText}>Continue with Apple</Text>
              </TouchableOpacity>
            )}

            {/* Google */}
            <TouchableOpacity style={s.btnGoogle} onPress={() => googlePromptAsync()} disabled={!googleRequest} activeOpacity={0.8}>
              <View style={s.gBadge}>
                <Text style={s.gLetter}>G</Text>
              </View>
              <Text style={s.btnGoogleText}>Continue with Google</Text>
            </TouchableOpacity>

            {/* Sign up */}
            <TouchableOpacity style={s.btnSignup} onPress={() => switchMode('email-signup')} activeOpacity={0.8}>
              <Text style={s.btnSignupText}>Sign up</Text>
            </TouchableOpacity>

            {/* Log in */}
            <TouchableOpacity style={s.btnLogin} onPress={() => switchMode('email-login')} activeOpacity={0.8}>
              <Text style={s.btnLoginText}>Log in</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={() => Linking.openURL('https://isibi.ai/privacy')} style={{ alignItems: 'center', paddingTop: 12 }}>
              <Text style={s.termsText}>By continuing, you agree to our{'\n'}Terms of Service & Privacy Policy</Text>
            </TouchableOpacity>
          </SafeAreaView>
        </Animated.View>
      </View>
    );
  }

  // ==================== 2FA VERIFICATION ====================
  if (mode === '2fa') {
    return (
      <SafeAreaView style={s.formRoot}>
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView contentContainerStyle={s.formScroll} keyboardShouldPersistTaps="handled">
              <View style={s.formNav}>
                <TouchableOpacity onPress={() => { switchMode('email-login'); setTotpCode(''); setTempToken(''); }}><Text style={s.navBack}>{'<'}</Text></TouchableOpacity>
                <Text style={s.navTitle}>Two-Factor Auth</Text>
                <View style={{ width: 28 }} />
              </View>
              <View style={s.formCenter}>
                <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: '#ec489915', alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginBottom: 20 }}>
                  <Text style={{ fontSize: 28 }}>🔐</Text>
                </View>
                <Text style={s.formHeading}>Enter verification code</Text>
                <Text style={s.formSub}>Open your authenticator app and enter the 6-digit code</Text>
                <View style={[s.inputBox, focusedField === 'totp' && s.inputBoxFocus]}>
                  <TextInput style={[s.formInput, { textAlign: 'center', fontSize: 24, letterSpacing: 8 }]} placeholder="000000" placeholderTextColor="#ccc" value={totpCode} onChangeText={(t) => setTotpCode(t.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" maxLength={6} onFocus={() => setFocusedField('totp')} onBlur={() => setFocusedField('')} autoFocus onSubmitEditing={handle2FALogin} accessibilityLabel="2FA code" />
                </View>
                <TouchableOpacity style={[s.submitBtn, totpCode.length !== 6 && { opacity: 0.4 }]} onPress={handle2FALogin} disabled={totpCode.length !== 6} activeOpacity={0.8}>
                  <Text style={s.submitText}>Verify & Log In</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        </TouchableWithoutFeedback>
      </SafeAreaView>
    );
  }

  // ==================== FORGOT PASSWORD ====================
  if (mode === 'forgot') {
    return (
      <SafeAreaView style={s.formRoot}>
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView contentContainerStyle={s.formScroll} keyboardShouldPersistTaps="handled">
              <View style={s.formNav}>
                <TouchableOpacity onPress={() => switchMode('email-login')}><Text style={s.navBack}>{'<'}</Text></TouchableOpacity>
                <Text style={s.navTitle}>Reset Password</Text>
                <View style={{ width: 28 }} />
              </View>
              <View style={s.formCenter}>
                <Text style={s.formHeading}>Forgot password?</Text>
                <Text style={s.formSub}>Enter your email and we'll send you a reset code</Text>
                <View style={[s.inputBox, focusedField === 'email' && s.inputBoxFocus]}>
                  <TextInput style={s.formInput} placeholder="Email address" placeholderTextColor="#999" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" onFocus={() => setFocusedField('email')} onBlur={() => setFocusedField('')} accessibilityLabel="Email address" />
                </View>
                <TouchableOpacity style={[s.submitBtn, !email && { opacity: 0.4 }]} onPress={handleForgotPassword} disabled={!email} activeOpacity={0.8}>
                  <Text style={s.submitText}>Send Reset Code</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        </TouchableWithoutFeedback>
      </SafeAreaView>
    );
  }

  // ==================== RESET PASSWORD ====================
  if (mode === 'reset') {
    return (
      <SafeAreaView style={s.formRoot}>
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView contentContainerStyle={s.formScroll} keyboardShouldPersistTaps="handled">
              <View style={s.formNav}>
                <TouchableOpacity onPress={() => switchMode('forgot')}><Text style={s.navBack}>{'<'}</Text></TouchableOpacity>
                <Text style={s.navTitle}>New Password</Text>
                <View style={{ width: 28 }} />
              </View>
              <View style={s.formCenter}>
                <Text style={s.formHeading}>Enter reset code</Text>
                <Text style={s.formSub}>Check your email for the 6-digit code</Text>
                <View style={[s.inputBox, focusedField === 'code' && s.inputBoxFocus]}>
                  <TextInput style={s.formInput} placeholder="6-digit code" placeholderTextColor="#999" value={resetCode} onChangeText={setResetCode} keyboardType="number-pad" maxLength={6} onFocus={() => setFocusedField('code')} onBlur={() => setFocusedField('')} accessibilityLabel="Reset code" />
                </View>
                <View style={[s.inputBox, focusedField === 'newpw' && s.inputBoxFocus]}>
                  <TextInput style={s.formInput} placeholder="New password" placeholderTextColor="#999" value={newPassword} onChangeText={setNewPassword} secureTextEntry onFocus={() => setFocusedField('newpw')} onBlur={() => setFocusedField('')} accessibilityLabel="New password" />
                </View>
                <TouchableOpacity style={[s.submitBtn, (!resetCode || !newPassword) && { opacity: 0.4 }]} onPress={handleResetPassword} disabled={!resetCode || !newPassword} activeOpacity={0.8}>
                  <Text style={s.submitText}>Reset Password</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        </TouchableWithoutFeedback>
      </SafeAreaView>
    );
  }

  if (mode === 'verify-email') {
    return (
      <SafeAreaView style={s.formRoot}>
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView contentContainerStyle={s.formScroll} keyboardShouldPersistTaps="handled">
              <View style={s.formNav}>
                <TouchableOpacity onPress={() => switchMode('email-signup')}><Text style={s.navBack}>{'<'}</Text></TouchableOpacity>
                <Text style={s.navTitle}>Verify Email</Text>
                <View style={{ width: 28 }} />
              </View>
              <View style={s.formCenter}>
                <Text style={s.formHeading}>Check your inbox</Text>
                <Text style={s.formSub}>We sent a verification code to {email}</Text>
                <View style={[s.inputBox, focusedField === 'vcode' && s.inputBoxFocus]}>
                  <TextInput
                    style={s.formInput}
                    placeholder="Verification code"
                    placeholderTextColor="#999"
                    value={verifyCode}
                    onChangeText={setVerifyCode}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    maxLength={12}
                    onFocus={() => setFocusedField('vcode')}
                    onBlur={() => setFocusedField('')}
                    onSubmitEditing={handleVerifyEmail}
                    returnKeyType="done"
                    accessibilityLabel="Verification code"
                  />
                </View>
                <TouchableOpacity style={[s.submitBtn, !verifyCode && { opacity: 0.4 }]} onPress={handleVerifyEmail} disabled={!verifyCode || loading} activeOpacity={0.8}>
                  {loading ? <ActivityIndicator color="#fff" /> : <Text style={s.submitText}>Verify & Continue</Text>}
                </TouchableOpacity>
                <TouchableOpacity onPress={handleResendVerification} style={{ marginTop: 18 }}>
                  <Text style={{ color: '#666', fontSize: 14, textAlign: 'center' }}>Didn't get it? <Text style={{ color: '#1a1a1a', fontWeight: '600' }}>Resend code</Text></Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        </TouchableWithoutFeedback>
      </SafeAreaView>
    );
  }

  // ==================== EMAIL FORM ====================
  return (
    <SafeAreaView style={s.formRoot}>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Animated.ScrollView contentContainerStyle={s.formScroll} keyboardShouldPersistTaps="handled" style={{ opacity: transitionFade }}>
            {/* Nav */}
            <View style={s.formNav}>
              <TouchableOpacity onPress={() => switchMode('welcome')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Text style={s.navBack}>‹</Text>
              </TouchableOpacity>
              <Text style={s.navTitle}>{mode === 'email-login' ? 'Log in' : 'Create account'}</Text>
              <View style={{ width: 28 }} />
            </View>

            <View style={s.formCenter}>
              <Animated.View style={[s.formOrb, { transform: [{ scale: orbScale }] }]} />
              <Text style={s.formHeading}>{mode === 'email-login' ? 'Welcome back' : 'Start your journey'}</Text>
              <Text style={s.formSub}>{mode === 'email-login' ? 'Sign in to GoFarther AI' : 'Create your GoFarther AI account'}</Text>

              {mode === 'email-signup' && (
                <View style={[s.inputBox, focusedField === 'name' && s.inputBoxFocus]}>
                  <TextInput style={s.formInput} placeholder="Full name" placeholderTextColor="#999" value={name} onChangeText={setName} autoCapitalize="words" onFocus={() => setFocusedField('name')} onBlur={() => setFocusedField('')} returnKeyType="next" />
                </View>
              )}

              <View style={[s.inputBox, focusedField === 'email' && s.inputBoxFocus]}>
                <TextInput style={s.formInput} placeholder="Email address" placeholderTextColor="#999" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} onFocus={() => setFocusedField('email')} onBlur={() => setFocusedField('')} returnKeyType="next" />
              </View>

              <View style={[s.inputBox, focusedField === 'password' && s.inputBoxFocus]}>
                <TextInput style={[s.formInput, { paddingRight: 50 }]} placeholder={mode === 'email-signup' ? 'Create password' : 'Password'} placeholderTextColor="#999" value={password} onChangeText={setPassword} secureTextEntry={!showPassword} onFocus={() => setFocusedField('password')} onBlur={() => setFocusedField('')} returnKeyType="done" onSubmitEditing={mode === 'email-login' ? handleEmailLogin : handleEmailSignup} />
                <TouchableOpacity style={s.eye} onPress={() => setShowPassword(!showPassword)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <Text style={{ fontSize: 18 }}>{showPassword ? '👁' : '👁‍🗨'}</Text>
                </TouchableOpacity>
              </View>

              {mode === 'email-login' && (
                <TouchableOpacity style={{ alignSelf: 'flex-end', marginBottom: 8, marginTop: -6 }} onPress={() => switchMode('forgot')}>
                  <Text style={{ fontSize: 12, color: C.primary, fontWeight: '500' }}>Forgot password?</Text>
                </TouchableOpacity>
              )}
              {mode === 'email-signup' && (
                <Text style={{ fontSize: 12, color: '#999', marginTop: -8, marginBottom: 8, marginLeft: 4 }}>Min 12 chars: uppercase, lowercase, number, special char</Text>
              )}

              {mode === 'email-login' && challengeRequired && (
                <View style={{ marginBottom: 14 }}>
                  <Text style={{ fontSize: 13, color: '#888', marginBottom: 8, textAlign: 'center' }}>{challengeQuestion}</Text>
                  <View style={[s.inputBox, focusedField === 'challenge' && s.inputBoxFocus]}>
                    <TextInput style={s.formInput} placeholder="Your answer" placeholderTextColor="#999" value={challengeAnswer} onChangeText={setChallengeAnswer} keyboardType="default" autoCapitalize="none" onFocus={() => setFocusedField('challenge')} onBlur={() => setFocusedField('')} returnKeyType="done" onSubmitEditing={handleEmailLogin} accessibilityLabel="Challenge answer" />
                  </View>
                </View>
              )}

              <TouchableOpacity style={[s.submitBtn, (!email || !password || (challengeRequired && !challengeAnswer)) && { opacity: 0.4 }]} onPress={mode === 'email-login' ? handleEmailLogin : handleEmailSignup} activeOpacity={0.8} disabled={!email || !password || (mode === 'email-login' && challengeRequired && !challengeAnswer)}>
                <Text style={s.submitText}>{mode === 'email-login' ? 'Log In' : 'Create Account'}</Text>
              </TouchableOpacity>

              <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: 24 }}>
                <Text style={{ fontSize: 13, color: '#666' }}>
                  {mode === 'email-login' ? "Don't have an account? " : 'Already have an account? '}
                </Text>
                <TouchableOpacity onPress={() => switchMode(mode === 'email-login' ? 'email-signup' : 'email-login')}>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: C.primary }}>{mode === 'email-login' ? 'Sign up' : 'Log in'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Animated.ScrollView>
        </KeyboardAvoidingView>
      </TouchableWithoutFeedback>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  // ============ WELCOME ============
  root: { flex: 1, backgroundColor: '#f5f5f5' },

  whiteArea: {
    flex: 1,
    backgroundColor: '#ffffff',
    justifyContent: 'center',
    alignItems: 'center',
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    overflow: 'hidden',
  },
  phraseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
    paddingHorizontal: 24,
  },
  phraseNormal: {
    fontSize: 30,
    fontWeight: '600',
    color: '#1a1a1a',
    letterSpacing: -0.3,
  },
  phraseHighlight: {
    fontSize: 30,
    fontWeight: '800',
    color: '#ec4899',
    letterSpacing: -0.3,
  },
  orbDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#ec489925',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 10,
  },
  orbDotInner: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#ec4899',
  },

  bottomPanel: {
    backgroundColor: '#f5f5f5',
    paddingTop: 24,
  },
  panelContent: {
    paddingHorizontal: 22,
    paddingBottom: 8,
  },

  // Apple — black button
  btnApple: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000000',
    borderRadius: 28,
    height: 56,
    marginBottom: 10,
  },
  appleIcon: {
    fontFamily: Platform.OS === 'ios' ? 'System' : 'sans-serif',
    fontSize: 20,
    color: '#ffffff',
    marginRight: 10,
  },
  btnAppleText: { fontSize: 16, fontWeight: '600', color: '#ffffff' },

  // Google — white button with border
  btnGoogle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 28,
    height: 56,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  gBadge: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: '#ffffff',
    alignItems: 'center', justifyContent: 'center',
    marginRight: 10,
  },
  gLetter: { fontSize: 15, fontWeight: '800', color: '#4285F4' },
  btnGoogleText: { fontSize: 16, fontWeight: '600', color: '#1a1a1a' },

  // Sign up — pink
  btnSignup: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ec4899',
    borderRadius: 28,
    height: 56,
    marginBottom: 10,
    shadowColor: '#ec4899',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
  },
  btnSignupText: { fontSize: 16, fontWeight: '700', color: '#ffffff' },

  // Log in — outlined
  btnLogin: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 28,
    height: 56,
    borderWidth: 1.5,
    borderColor: '#d0d0d0',
    backgroundColor: '#ffffff',
  },
  btnLoginText: { fontSize: 16, fontWeight: '600', color: '#1a1a1a' },

  termsText: { fontSize: 11, color: '#999', textAlign: 'center', lineHeight: 16 },

  // ============ LOADING ============
  loadingWrap: {
    flex: 1, backgroundColor: '#ffffff',
    justifyContent: 'center', alignItems: 'center',
  },
  loadingOrbOuter: {
    position: 'absolute',
    width: 100, height: 100, borderRadius: 50,
    backgroundColor: '#ec4899',
  },
  loadingOrbInner: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: '#ec4899',
    marginBottom: 28,
    shadowColor: '#ec4899', shadowOpacity: 0.3, shadowRadius: 24,
  },
  loadingText: { color: '#1a1a1a', fontSize: 16, fontWeight: '600' },
  loadingHint: { color: '#999', fontSize: 12, marginTop: 8 },

  // ============ EMAIL FORM ============
  formRoot: { flex: 1, backgroundColor: '#ffffff' },
  formScroll: { flexGrow: 1, padding: 24, paddingTop: 0 },
  formNav: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 12,
  },
  navBack: { fontSize: 32, color: '#1a1a1a', fontWeight: '300' },
  navTitle: { fontSize: 16, fontWeight: '600', color: '#1a1a1a' },

  formCenter: { flex: 1, justifyContent: 'center' },
  formOrb: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: '#ec4899', alignSelf: 'center', marginBottom: 20,
    shadowColor: '#ec4899', shadowOpacity: 0.25, shadowRadius: 16,
  },
  formHeading: { fontSize: 24, fontWeight: '700', color: '#1a1a1a', textAlign: 'center', marginBottom: 6 },
  formSub: { fontSize: 13, color: '#888', textAlign: 'center', marginBottom: 32 },

  inputBox: {
    width: '100%', backgroundColor: '#f5f5f5',
    borderWidth: 1.5, borderColor: '#e0e0e0',
    borderRadius: 16, marginBottom: 14,
    flexDirection: 'row', alignItems: 'center',
  },
  inputBoxFocus: { borderColor: '#ec4899' },
  formInput: { flex: 1, padding: 16, color: '#1a1a1a', fontSize: 15 },
  eye: { position: 'absolute', right: 16 },

  submitBtn: {
    width: '100%', height: 56, borderRadius: 28,
    backgroundColor: '#ec4899', alignItems: 'center', justifyContent: 'center', marginTop: 8,
    shadowColor: '#ec4899', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 12,
  },
  submitText: { color: '#ffffff', fontSize: 16, fontWeight: '700' },
});
