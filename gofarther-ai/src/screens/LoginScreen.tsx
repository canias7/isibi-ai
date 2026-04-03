import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, Alert, ActivityIndicator, ScrollView } from 'react-native';
import { C, F, R } from '../lib/theme';
import { login, signup } from '../lib/api';

export default function LoginScreen({ onLogin }: { onLogin: () => void }) {
  const [mode, setMode] = useState<'welcome' | 'email-login' | 'email-signup'>('welcome');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleEmailLogin = async () => {
    if (!email || !password) { Alert.alert('Error', 'Please fill in all fields'); return; }
    setLoading(true);
    try {
      await login(email.toLowerCase().trim(), password);
      onLogin();
    } catch (e: any) { Alert.alert('Error', e.message || 'Login failed'); }
    finally { setLoading(false); }
  };

  const handleEmailSignup = async () => {
    if (!name || !email || !password) { Alert.alert('Error', 'Please fill in all fields'); return; }
    if (password.length < 6) { Alert.alert('Error', 'Password must be at least 6 characters'); return; }
    setLoading(true);
    try {
      await signup(email.toLowerCase().trim(), name.trim(), password);
      onLogin();
    } catch (e: any) { Alert.alert('Error', e.message || 'Signup failed'); }
    finally { setLoading(false); }
  };

  if (mode === 'welcome') {
    return (
      <View style={s.container}>
        {/* Logo */}
        <View style={s.logoArea}>
          <View style={s.orb} />
          <Text style={s.title}>GoFarther AI</Text>
          <Text style={s.sub}>Your AI agent, everywhere</Text>
        </View>

        {/* Social Buttons */}
        <View style={s.buttonArea}>
          <TouchableOpacity style={s.socialBtn}>
            <Text style={s.appleIcon}>🍎</Text>
            <Text style={s.socialBtnText}>Continue with Apple</Text>
          </TouchableOpacity>

          <TouchableOpacity style={s.socialBtnGoogle}>
            <Text style={s.googleIcon}>G</Text>
            <Text style={s.socialBtnTextGoogle}>Continue with Google</Text>
          </TouchableOpacity>

          <View style={s.divider}>
            <View style={s.dividerLine} />
            <Text style={s.dividerText}>or</Text>
            <View style={s.dividerLine} />
          </View>

          <TouchableOpacity style={s.emailBtn} onPress={() => setMode('email-signup')}>
            <Text style={s.emailBtnText}>Sign up with email</Text>
          </TouchableOpacity>

          <View style={s.loginRow}>
            <Text style={s.loginText}>Already have an account? </Text>
            <TouchableOpacity onPress={() => setMode('email-login')}>
              <Text style={s.loginLink}>Log in</Text>
            </TouchableOpacity>
          </View>
        </View>

        <Text style={s.terms}>By continuing, you agree to our Terms of Service and Privacy Policy</Text>
      </View>
    );
  }

  // Email Login / Signup form
  return (
    <KeyboardAvoidingView style={s.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={s.scrollContent} keyboardShouldPersistTaps="handled">
        <TouchableOpacity style={s.backBtn} onPress={() => setMode('welcome')}>
          <Text style={s.backText}>← Back</Text>
        </TouchableOpacity>

        <View style={s.formLogo}>
          <View style={s.orbSmall} />
          <Text style={s.formTitle}>{mode === 'email-login' ? 'Welcome back' : 'Create your account'}</Text>
          <Text style={s.formSub}>{mode === 'email-login' ? 'Log in to GoFarther AI' : 'Start your AI journey'}</Text>
        </View>

        {mode === 'email-signup' && (
          <TextInput
            style={s.input}
            placeholder="Full name"
            placeholderTextColor={C.textDim}
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
          />
        )}

        <TextInput
          style={s.input}
          placeholder="Email address"
          placeholderTextColor={C.textDim}
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
        />

        <TextInput
          style={s.input}
          placeholder={mode === 'email-signup' ? 'Create password (min 6 characters)' : 'Password'}
          placeholderTextColor={C.textDim}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />

        {mode === 'email-login' && (
          <TouchableOpacity style={s.forgotBtn}>
            <Text style={s.forgotText}>Forgot password?</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={s.submitBtn}
          onPress={mode === 'email-login' ? handleEmailLogin : handleEmailSignup}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text style={s.submitBtnText}>{mode === 'email-login' ? 'Log In' : 'Create Account'}</Text>
          )}
        </TouchableOpacity>

        <View style={s.switchRow}>
          <Text style={s.switchText}>
            {mode === 'email-login' ? "Don't have an account? " : 'Already have an account? '}
          </Text>
          <TouchableOpacity onPress={() => setMode(mode === 'email-login' ? 'email-signup' : 'email-login')}>
            <Text style={s.switchLink}>{mode === 'email-login' ? 'Sign up' : 'Log in'}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  scrollContent: { flex: 1, justifyContent: 'center', padding: 24 },

  // Welcome screen
  logoArea: { alignItems: 'center', marginBottom: 48 },
  orb: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: C.primary,
    shadowColor: C.primary, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.6, shadowRadius: 30,
    marginBottom: 20,
  },
  title: { fontSize: 28, fontWeight: '800', color: C.text, marginBottom: 6 },
  sub: { fontSize: F.md, color: C.textMid },

  buttonArea: { width: '100%', paddingHorizontal: 8 },

  socialBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#fff', borderRadius: R.md, padding: 16, marginBottom: 12,
  },
  appleIcon: { fontSize: 20, marginRight: 10 },
  socialBtnText: { fontSize: F.md, fontWeight: '600', color: '#000' },

  socialBtnGoogle: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.card, borderRadius: R.md, padding: 16, marginBottom: 20,
    borderWidth: 1, borderColor: C.border,
  },
  googleIcon: { fontSize: 18, fontWeight: '700', color: '#4285F4', marginRight: 10 },
  socialBtnTextGoogle: { fontSize: F.md, fontWeight: '600', color: C.text },

  divider: { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
  dividerLine: { flex: 1, height: 1, backgroundColor: C.border },
  dividerText: { paddingHorizontal: 16, fontSize: F.sm, color: C.textDim },

  emailBtn: {
    borderRadius: R.md, padding: 16, alignItems: 'center',
    borderWidth: 1, borderColor: C.primary, marginBottom: 16,
  },
  emailBtnText: { fontSize: F.md, fontWeight: '600', color: C.primary },

  loginRow: { flexDirection: 'row', justifyContent: 'center', marginTop: 8 },
  loginText: { fontSize: F.sm, color: C.textMid },
  loginLink: { fontSize: F.sm, fontWeight: '600', color: C.primary },

  terms: { position: 'absolute', bottom: 40, fontSize: 10, color: C.textDim, textAlign: 'center', paddingHorizontal: 40 },

  // Form screen
  backBtn: { marginBottom: 24 },
  backText: { fontSize: F.md, color: C.primary, fontWeight: '500' },

  formLogo: { alignItems: 'center', marginBottom: 32 },
  orbSmall: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: C.primary,
    shadowColor: C.primary, shadowOpacity: 0.4, shadowRadius: 16,
    marginBottom: 16,
  },
  formTitle: { fontSize: F.xl, fontWeight: '700', color: C.text, marginBottom: 4 },
  formSub: { fontSize: F.sm, color: C.textMid },

  input: {
    width: '100%', padding: 16,
    backgroundColor: C.card, borderWidth: 1, borderColor: C.border,
    borderRadius: R.md, color: C.text, fontSize: F.md, marginBottom: 14,
  },

  forgotBtn: { alignSelf: 'flex-end', marginBottom: 8, marginTop: -6 },
  forgotText: { fontSize: F.xs, color: C.primary },

  submitBtn: {
    width: '100%', padding: 16, borderRadius: R.md,
    backgroundColor: C.primary, alignItems: 'center', marginTop: 8,
  },
  submitBtnText: { color: 'white', fontSize: F.md, fontWeight: '700' },

  switchRow: { flexDirection: 'row', justifyContent: 'center', marginTop: 20 },
  switchText: { fontSize: F.sm, color: C.textMid },
  switchLink: { fontSize: F.sm, fontWeight: '600', color: C.primary },
});
