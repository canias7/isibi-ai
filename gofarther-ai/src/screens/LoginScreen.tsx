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
import { C, F, R } from '../lib/theme';
import { login, signup, socialLogin } from '../lib/api';

WebBrowser.maybeCompleteAuthSession();

const GOOGLE_CLIENT_ID_WEB = '321209982665-uboadljp5d0hl426rrntnnmg8c6l5v2f.apps.googleusercontent.com';
const GOOGLE_CLIENT_ID_IOS = '321209982665-agd7dabtpq1jujo8fqsf6j7o70hva44b.apps.googleusercontent.com';
const { height: SCREEN_HEIGHT } = Dimensions.get('window');

export default function LoginScreen({ onLogin }: { onLogin: () => void }) {
  const [mode, setMode] = useState<'welcome' | 'email-login' | 'email-signup'>('welcome');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [focusedField, setFocusedField] = useState('');

  // Animations
  const orbPulse = useRef(new Animated.Value(1)).current;
  const fadeIn = useRef(new Animated.Value(0)).current;
  const slideUp = useRef(new Animated.Value(30)).current;

  useEffect(() => {
    // Orb breathing animation
    Animated.loop(
      Animated.sequence([
        Animated.timing(orbPulse, { toValue: 1.08, duration: 2000, useNativeDriver: true }),
        Animated.timing(orbPulse, { toValue: 1, duration: 2000, useNativeDriver: true }),
      ])
    ).start();

    // Fade in content
    Animated.parallel([
      Animated.timing(fadeIn, { toValue: 1, duration: 800, useNativeDriver: true }),
      Animated.timing(slideUp, { toValue: 0, duration: 800, useNativeDriver: true }),
    ]).start();
  }, []);

  // Animate mode transitions
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
      await login(email.toLowerCase().trim(), password);
      onLogin();
    } catch (e: any) { Alert.alert('Login failed', e.message || 'Check your credentials and try again'); }
    finally { setLoading(false); }
  };

  const handleEmailSignup = async () => {
    if (!name || !email || !password) { Alert.alert('Missing fields', 'Please fill in all fields'); return; }
    if (!isValidEmail(email)) { Alert.alert('Invalid email', 'Please enter a valid email address'); return; }
    if (password.length < 6) { Alert.alert('Weak password', 'Password must be at least 6 characters'); return; }
    setLoading(true);
    try {
      await signup(email.toLowerCase().trim(), name.trim(), password);
      onLogin();
    } catch (e: any) { Alert.alert('Signup failed', e.message || 'Something went wrong'); }
    finally { setLoading(false); }
  };

  // Loading screen with animated orb
  if (loading) {
    return (
      <SafeAreaView style={[s.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <Animated.View style={[s.orbLoading, { transform: [{ scale: orbPulse }] }]} />
        <Text style={s.loadingText}>Signing in...</Text>
        <Text style={s.loadingHint}>First login may take a moment</Text>
      </SafeAreaView>
    );
  }

  // Welcome screen
  if (mode === 'welcome') {
    return (
      <SafeAreaView style={s.container}>
        <Animated.View style={[s.welcomeContent, { opacity: fadeIn, transform: [{ translateY: slideUp }] }]}>
          {/* Logo area — centered */}
          <View style={s.logoArea}>
            <Animated.View style={[s.orb, { transform: [{ scale: orbPulse }] }]} />
            <Text style={s.title}>GoFarther AI</Text>
            <Text style={s.sub}>Your AI agent, everywhere</Text>
          </View>

          {/* Buttons pinned to bottom */}
          <View style={s.buttonArea}>
            {appleAvailable && (
              <TouchableOpacity style={s.appleBtn} onPress={handleAppleAuth} activeOpacity={0.8}>
                <Text style={s.appleLogo}>{'\uF8FF'}</Text>
                <Text style={s.appleBtnText}>Continue with Apple</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity style={s.googleBtn} onPress={() => googlePromptAsync()} disabled={!googleRequest} activeOpacity={0.8}>
              <View style={s.googleLogoWrap}>
                <Text style={s.googleG}>G</Text>
              </View>
              <Text style={s.googleBtnText}>Continue with Google</Text>
            </TouchableOpacity>

            <View style={s.divider}>
              <View style={s.dividerLine} />
              <Text style={s.dividerText}>or</Text>
              <View style={s.dividerLine} />
            </View>

            <TouchableOpacity style={s.emailBtn} onPress={() => switchMode('email-signup')} activeOpacity={0.8}>
              <Text style={s.emailBtnText}>Sign up with email</Text>
            </TouchableOpacity>

            <View style={s.loginRow}>
              <Text style={s.loginText}>Already have an account? </Text>
              <TouchableOpacity onPress={() => switchMode('email-login')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Text style={s.loginLink}>Log in</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity onPress={() => Linking.openURL('https://isibi.ai/privacy')} style={s.termsBtn}>
              <Text style={s.terms}>By continuing, you agree to our Terms of Service and Privacy Policy</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </SafeAreaView>
    );
  }

  // Email form screen
  return (
    <SafeAreaView style={s.container}>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Animated.ScrollView contentContainerStyle={s.scrollContent} keyboardShouldPersistTaps="handled" style={{ opacity: transitionFade }}>
            <TouchableOpacity style={s.backBtn} onPress={() => switchMode('welcome')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={s.backChevron}>‹</Text>
              <Text style={s.backText}>Back</Text>
            </TouchableOpacity>

            <View style={s.formLogo}>
              <Animated.View style={[s.orbSmall, { transform: [{ scale: orbPulse }] }]} />
              <Text style={s.formTitle}>{mode === 'email-login' ? 'Welcome back' : 'Create your account'}</Text>
              <Text style={s.formSub}>{mode === 'email-login' ? 'Log in to GoFarther AI' : 'Start your AI journey'}</Text>
            </View>

            {mode === 'email-signup' && (
              <View style={[s.inputWrap, focusedField === 'name' && s.inputWrapFocused]}>
                <TextInput
                  style={s.input}
                  placeholder="Full name"
                  placeholderTextColor={C.textDim}
                  value={name}
                  onChangeText={setName}
                  autoCapitalize="words"
                  onFocus={() => setFocusedField('name')}
                  onBlur={() => setFocusedField('')}
                  returnKeyType="next"
                />
              </View>
            )}

            <View style={[s.inputWrap, focusedField === 'email' && s.inputWrapFocused]}>
              <TextInput
                style={s.input}
                placeholder="Email address"
                placeholderTextColor={C.textDim}
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                onFocus={() => setFocusedField('email')}
                onBlur={() => setFocusedField('')}
                returnKeyType="next"
              />
            </View>

            <View style={[s.inputWrap, focusedField === 'password' && s.inputWrapFocused]}>
              <TextInput
                style={[s.input, { paddingRight: 50 }]}
                placeholder={mode === 'email-signup' ? 'Create password' : 'Password'}
                placeholderTextColor={C.textDim}
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                onFocus={() => setFocusedField('password')}
                onBlur={() => setFocusedField('')}
                returnKeyType="done"
                onSubmitEditing={mode === 'email-login' ? handleEmailLogin : handleEmailSignup}
              />
              <TouchableOpacity style={s.eyeBtn} onPress={() => setShowPassword(!showPassword)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Text style={s.eyeIcon}>{showPassword ? '👁' : '👁‍🗨'}</Text>
              </TouchableOpacity>
            </View>

            {mode === 'email-login' && (
              <TouchableOpacity style={s.forgotBtn} onPress={() => Alert.alert('Reset Password', 'Password reset coming soon')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Text style={s.forgotText}>Forgot password?</Text>
              </TouchableOpacity>
            )}

            {mode === 'email-signup' && (
              <Text style={s.passwordHint}>Must be at least 6 characters</Text>
            )}

            <TouchableOpacity
              style={[s.submitBtn, (!email || !password) && s.submitBtnDisabled]}
              onPress={mode === 'email-login' ? handleEmailLogin : handleEmailSignup}
              activeOpacity={0.8}
              disabled={!email || !password}
            >
              <Text style={s.submitBtnText}>{mode === 'email-login' ? 'Log In' : 'Create Account'}</Text>
            </TouchableOpacity>

            <View style={s.switchRow}>
              <Text style={s.switchText}>
                {mode === 'email-login' ? "Don't have an account? " : 'Already have an account? '}
              </Text>
              <TouchableOpacity onPress={() => switchMode(mode === 'email-login' ? 'email-signup' : 'email-login')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Text style={s.switchLink}>{mode === 'email-login' ? 'Sign up' : 'Log in'}</Text>
              </TouchableOpacity>
            </View>
          </Animated.ScrollView>
        </KeyboardAvoidingView>
      </TouchableWithoutFeedback>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },

  // Welcome
  welcomeContent: { flex: 1, justifyContent: 'space-between' },
  logoArea: { alignItems: 'center', paddingTop: SCREEN_HEIGHT * 0.12 },
  orb: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: C.primary,
    shadowColor: C.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.5, shadowRadius: 24,
    marginBottom: 24,
  },
  title: { fontSize: 32, fontWeight: '800', color: C.text, letterSpacing: -0.5, marginBottom: 8 },
  sub: { fontSize: F.md, color: C.textMid, letterSpacing: 0.2 },

  buttonArea: { paddingHorizontal: 24, paddingBottom: 16 },

  // Apple button — black with white text (Apple HIG)
  appleBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#fff', borderRadius: R.lg, height: 54, marginBottom: 12,
  },
  appleLogo: { fontFamily: Platform.OS === 'ios' ? 'System' : 'sans-serif', fontSize: 22, color: '#000', marginRight: 8 },
  appleBtnText: { fontSize: 16, fontWeight: '600', color: '#000' },

  // Google button
  googleBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.card, borderRadius: R.lg, height: 54, marginBottom: 24,
    borderWidth: 1, borderColor: C.border,
  },
  googleLogoWrap: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', marginRight: 10,
  },
  googleG: { fontSize: 15, fontWeight: '800', color: '#4285F4' },
  googleBtnText: { fontSize: 16, fontWeight: '600', color: C.text },

  divider: { flexDirection: 'row', alignItems: 'center', marginBottom: 24 },
  dividerLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: C.border },
  dividerText: { paddingHorizontal: 16, fontSize: F.sm, color: C.textDim, fontWeight: '500' },

  emailBtn: {
    borderRadius: R.lg, height: 54, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: C.primary, marginBottom: 20,
  },
  emailBtnText: { fontSize: 16, fontWeight: '600', color: C.primary },

  loginRow: { flexDirection: 'row', justifyContent: 'center', marginBottom: 16 },
  loginText: { fontSize: F.sm, color: C.textMid },
  loginLink: { fontSize: F.sm, fontWeight: '700', color: C.primary },

  termsBtn: { alignItems: 'center', paddingTop: 8, paddingBottom: 4 },
  terms: { fontSize: 11, color: C.textDim, textAlign: 'center', lineHeight: 16, textDecorationLine: 'underline' },

  // Loading
  orbLoading: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: C.primary,
    shadowColor: C.primary, shadowOpacity: 0.6, shadowRadius: 24, marginBottom: 24,
  },
  loadingText: { color: C.text, fontSize: F.md, fontWeight: '600' },
  loadingHint: { color: C.textDim, fontSize: F.xs, marginTop: 8 },

  // Form
  scrollContent: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  backBtn: { flexDirection: 'row', alignItems: 'center', marginBottom: 32 },
  backChevron: { fontSize: 28, color: C.primary, fontWeight: '300', marginRight: 4, marginTop: -2 },
  backText: { fontSize: F.md, color: C.primary, fontWeight: '500' },

  formLogo: { alignItems: 'center', marginBottom: 36 },
  orbSmall: {
    width: 52, height: 52, borderRadius: 26, backgroundColor: C.primary,
    shadowColor: C.primary, shadowOpacity: 0.4, shadowRadius: 16, marginBottom: 20,
  },
  formTitle: { fontSize: 24, fontWeight: '700', color: C.text, marginBottom: 6 },
  formSub: { fontSize: F.sm, color: C.textMid },

  inputWrap: {
    width: '100%', backgroundColor: C.card, borderWidth: 1.5, borderColor: C.border,
    borderRadius: R.lg, marginBottom: 14, flexDirection: 'row', alignItems: 'center',
  },
  inputWrapFocused: { borderColor: C.primary },
  input: { flex: 1, padding: 16, color: C.text, fontSize: F.md },
  eyeBtn: { position: 'absolute', right: 16 },
  eyeIcon: { fontSize: 18 },

  forgotBtn: { alignSelf: 'flex-end', marginBottom: 12, marginTop: -4 },
  forgotText: { fontSize: F.xs, color: C.primary, fontWeight: '500' },
  passwordHint: { fontSize: F.xs, color: C.textDim, marginTop: -8, marginBottom: 12, marginLeft: 4 },

  submitBtn: {
    width: '100%', height: 54, borderRadius: R.lg,
    backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center', marginTop: 8,
    shadowColor: C.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 12,
  },
  submitBtnDisabled: { opacity: 0.5, shadowOpacity: 0 },
  submitBtnText: { color: 'white', fontSize: 16, fontWeight: '700' },

  switchRow: { flexDirection: 'row', justifyContent: 'center', marginTop: 24 },
  switchText: { fontSize: F.sm, color: C.textMid },
  switchLink: { fontSize: F.sm, fontWeight: '700', color: C.primary },
});
