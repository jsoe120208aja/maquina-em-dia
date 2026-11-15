import "./style.css";
import { auth, db } from "./firebase.js";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail, signOut, onAuthStateChanged } from "firebase/auth";
import { collection, doc, getDoc, setDoc, addDoc, deleteDoc, onSnapshot, writeBatch, query, orderBy } from "firebase/firestore";
import * as XLSX from "xlsx";
import { Capacitor } from "@capacitor/core";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

const $ = (id) => document.getElementById(id);
const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

let me = null, perfil = null, docs = [], unsub = null, criando = false, adiado = false;
let vista = "todas", pessoaSel = null;
let atv = {}, atvUnsub = {};
const abertos = new Set();
const MIN = "2020-01-01T00:00";

// ---------- utilidades ----------
const emailOk = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const agora = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
const fmt = (s) => { if (!s) return ""; const d = new Date(s); return isNaN(d) ? s : d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }); };
const aberta = (o) => !o.fimEm;
function minutos(o) {
  const a = new Date(o.inicioEm); if (isNaN(a)) return null;
  const b = o.fimEm ? new Date(o.fimEm) : null;
  return Math.max(0, Math.round(((b && !isNaN(b) ? b : new Date()) - a) / 60000));
}
function tempo(o) {
  const m = minutos(o); if (m === null) return "";
  const d = Math.floor(m / 1440), hh = Math.floor((m % 1440) / 60), n = m % 60;
  return (d ? d + "d " : "") + (hh ? hh + "h " : "") + n + "min" + (o.fimEm ? "" : " (em aberto)");
}
function checarDatas(ini, fim) {
  const lim = agora();
  if (!ini || ini < MIN || ini > lim) return "A data e o início precisam estar entre 01/01/2020 e agora.";
  if (fim) {
    if (fim < MIN || fim > lim) return "O fim da ocorrência precisa estar entre 01/01/2020 e agora.";
    if (fim < ini) return "O fim não pode ser antes do início.";
  }
  return "";
}
function ver(nome) {
  ["entrar", "criar", "app"].forEach((v) => $(v).classList.toggle("hide", v !== nome));
  $("sair").classList.toggle("hide", nome !== "app");
  document.querySelectorAll(".err").forEach((e) => e.classList.remove("on"));
}
function erro(id, m) { const e = $(id); e.textContent = m; e.classList.add("on"); }

// ---------- login e conta ----------
function entrar(u, p) {
  me = u.uid; perfil = p;
  $("who").textContent = p.nome + " (" + p.email + ")";
  ver("app"); vista = "todas"; pessoaSel = null; mostrarVista();
  if (unsub) unsub();
  const u1 = onSnapshot(collection(db, "ocorrencias"),
    (snap) => { docs = snap.docs.map((d) => ({ id: d.id, ...d.data() })); render(); },
    () => { $("who").textContent = "Sem conexão com os dados"; });
  unsub = () => { u1(); Object.values(atvUnsub).forEach((f) => f()); atvUnsub = {}; atv = {}; abertos.clear(); };
}
onAuthStateChanged(auth, async (u) => {
  if (criando) return;
  if (!u) { me = null; perfil = null; docs = []; if (unsub) { unsub(); unsub = null; } ver("entrar"); return; }
  try {
    const s = await getDoc(doc(db, "usuarios", u.uid));
    if (!s.exists()) { await signOut(auth); setTimeout(() => erro("l-err", "Essa conta não tem perfil completo. Use Criar conta de novo com outro e-mail."), 400); return; }
    entrar(u, s.data());
  } catch (e) { await signOut(auth); ver("entrar"); setTimeout(() => erro("l-err", "Não foi possível abrir o painel." + det(e)), 400); }
});

const numKey = (n) => n.toLowerCase().replace(/[^a-z0-9]/g, "");
async function emailDoNumero(num) {
  const s = await getDoc(doc(db, "numeros", numKey(num)));
  return s.exists() ? s.data().email : null;
}
const mascara = (e) => e.replace(/^(.{2})[^@]*(@.*)$/, "$1***$2");
const det = (e, etapa) => " [" + ((e && e.code) || "sem-codigo") + (etapa ? " | " + etapa : "") + "]";
const MSG_CRED = "Número ou senha incorretos. Confira e tente de novo.";
function aviso(id, m) { const e = $(id); e.textContent = m; e.classList.add("on"); }

$("f-criar").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const num = $("c-num").value.trim(), nome = $("c-nome").value.trim();
  const email = $("c-email").value.trim(), s1 = $("c-senha").value, s2 = $("c-senha2").value;
  if (numKey(num).length < 3) return erro("c-err", "Escolha um número de segurança com pelo menos 3 letras ou números.");
  if (nome.length < 3) return erro("c-err", "Digite seu nome completo.");
  if (!emailOk(email)) return erro("c-err", "Digite um e-mail válido. Ele será usado para recuperar a senha.");
  if (s1.length < 6) return erro("c-err", "A senha precisa ter pelo menos 6 caracteres.");
  if (s1 !== s2) return erro("c-err", "As senhas não são iguais. Digite de novo.");
  criando = true;
  let cred = null, etapa = "numero";
  try {
    if (await emailDoNumero(num)) { criando = false; return erro("c-err", "Esse número de segurança já está em uso. Se for seu, use Entrar. Se não, escolha outro."); }
    etapa = "conta";
    cred = await createUserWithEmailAndPassword(auth, email, s1);
    etapa = "numero";
    await setDoc(doc(db, "numeros", numKey(num)), { email, uid: cred.user.uid });
    etapa = "perfil";
    const p = { numero: num, numeroKey: numKey(num), nome, email };
    await setDoc(doc(db, "usuarios", cred.user.uid), p);
    $("f-criar").reset(); criando = false; entrar(cred.user, p);
  } catch (e) {
    criando = false;
    if (cred) { try { await cred.user.delete(); } catch (_) {} await signOut(auth).catch(() => {}); }
    if (e.code === "auth/email-already-in-use") erro("c-err", "Esse e-mail já tem conta. Use Entrar ou Esqueci a senha.");
    else if (e.code === "auth/operation-not-allowed") erro("c-err", "O login por e-mail e senha não está ativado no Firebase (Authentication > Método de login)." + det(e, etapa));
    else if (e.code === "auth/weak-password") erro("c-err", "Senha fraca. Use pelo menos 6 caracteres.");
    else if (e.code === "auth/network-request-failed") erro("c-err", "Sem conexão com a internet." + det(e, etapa));
    else if (e.code === "permission-denied") erro("c-err", "O banco recusou o cadastro. Confira se as regras do Firestore foram publicadas." + det(e, etapa));
    else erro("c-err", "Não foi possível criar a conta." + det(e, etapa));
  }
});

$("f-login").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const num = $("l-num").value.trim(), senha = $("l-senha").value;
  $("l-ok").classList.remove("on");
  if (!num || !senha) return erro("l-err", "Digite o número de segurança e a senha.");
  try {
    const email = await emailDoNumero(num);
    if (!email) return erro("l-err", MSG_CRED);
    await signInWithEmailAndPassword(auth, email, senha); $("f-login").reset();
  } catch (e) {
    const credencial = ["auth/invalid-credential", "auth/user-not-found", "auth/wrong-password", "auth/invalid-email"].includes(e.code);
    erro("l-err", credencial ? MSG_CRED : "Não foi possível entrar agora." + det(e));
  }
});

$("esqueci").addEventListener("click", async () => {
  const num = $("l-num").value.trim();
  $("l-err").classList.remove("on"); $("l-ok").classList.remove("on");
  if (!num) return erro("l-err", "Digite seu número de segurança acima e toque em Esqueci a senha de novo.");
  try {
    const email = await emailDoNumero(num);
    if (!email) return erro("l-err", "Não encontrei conta com esse número de segurança.");
    await sendPasswordResetEmail(auth, email);
    aviso("l-ok", "Enviamos um link para criar uma nova senha em " + mascara(email) + ". Olhe também a caixa de spam.");
  } catch (e) { erro("l-err", "Não foi possível enviar o e-mail agora. Tente de novo."); }
});
$("sair").addEventListener("click", () => signOut(auth));
const atalho = (id, v) => { const a = $(id); a.addEventListener("click", () => ver(v)); a.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ver(v); } }); };
atalho("ir-criar", "criar"); atalho("ir-entrar", "entrar");

const NATIVO = Capacitor.isNativePlatform();
const salvarPlanilha = async (wb, nome) => {
  if (!NATIVO) return XLSX.writeFile(wb, nome);
  const r = await Filesystem.writeFile({ path: nome, data: XLSX.write(wb, { type: "base64", bookType: "xlsx" }), directory: Directory.Cache });
  await Share.share({ title: nome, url: r.uri, dialogTitle: "Salvar ou enviar a planilha" });
};

// ---------- navegação ----------
try { const a = localStorage.getItem("alertaH"); if (a !== null) $("alerta").value = a; } catch (_) {}
$("alerta").addEventListener("change", () => { try { localStorage.setItem("alertaH", $("alerta").value); } catch (_) {} render(); });

const hojeStr = () => agora().slice(0, 10);
const horaStr = () => agora().slice(11, 16);
const dataDe = (o) => (o.inicioEm || "").slice(0, 10);
const horaDe = (o) => (o.inicioEm || "").slice(11, 16);
const fmtData = (d) => (d ? d.split("-").reverse().join("/") : "");
const unicos = (arr) => {
  const m = new Map();
  arr.filter(Boolean).forEach((n) => { if (!m.has(numKey(n))) m.set(numKey(n), n); });
  return [...m.values()].sort((a, b) => a.localeCompare(b, "pt-BR"));
};
function opcoes(sel, lista, primeira) {
  sel.textContent = "";
  if (primeira != null) { const o = h("option", "", primeira); o.value = ""; sel.appendChild(o); }
  lista.forEach((x) => { const o = h("option", "", x); o.value = x; sel.appendChild(o); });
}
function listaDe(id, itens) { const dl = $(id); dl.textContent = ""; itens.forEach((n) => { const o = h("option"); o.value = n; dl.appendChild(o); }); }
function atualizarListas() {
  const linhas = unicos(docs.map((o) => o.linha)), lv = numKey($("linha").value);
  listaDe("linhas-lista", linhas);
  listaDe("postos-lista", unicos(docs.filter((o) => !lv || numKey(o.linha || "") === lv).map((o) => o.posto)));
  listaDe("resp-lista", unicos([...docs.map((o) => o.responsavel), perfil && perfil.nome]));
  const fl = $("f-linha"), atual = fl.value; opcoes(fl, linhas, "Todas as linhas"); fl.value = linhas.includes(atual) ? atual : "";
}
$("linha").addEventListener("input", atualizarListas);

// data e início são preenchidos automaticamente quando a ocorrência é aberta
function limitesForm() { $("data").min = MIN.slice(0, 10); $("data").max = hojeStr(); $("fim").min = MIN; $("fim").max = agora(); }
function preencherAbertura(forcar) {
  if (forcar || (!$("linha").value && !$("posto").value && !$("ocorr").value)) { $("data").value = hojeStr(); $("inicio").value = horaStr(); }
  limitesForm();
}
$("fim").addEventListener("focus", limitesForm);
$("fim-agora").addEventListener("click", () => { $("fim").value = agora(); });

const escopo = () => (vista === "pessoa" ? docs.filter((o) => (o.criadoPor || "sem-autor") === pessoaSel) : docs);
function nomePessoa(id) {
  const d = docs.find((o) => (o.criadoPor || "sem-autor") === id);
  return d && d.criadoNome ? d.criadoNome : id === me && perfil ? perfil.nome : "Autor desconhecido";
}
function migalhas() {
  const c = $("crumb"); c.textContent = "";
  const link = (t, fn) => { const a = h("a", "", t); a.setAttribute("role", "button"); a.tabIndex = 0; a.onclick = fn; a.onkeydown = (e) => { if (e.key === "Enter") fn(); }; c.appendChild(a); };
  link("Máquina em Dia", () => { vista = "todas"; pessoaSel = null; mostrarVista(); });
  if (vista === "pessoa") { c.append(" › "); link("Pessoas", () => { vista = "pessoas"; pessoaSel = null; mostrarVista(); }); c.append(" › " + nomePessoa(pessoaSel)); }
  else if (vista !== "todas") c.append(" › " + { linhas: "Linhas e postos", painel: "Painel", pessoas: "Pessoas" }[vista]);
}
function mostrarVista() {
  const v = vista;
  $("card-novo").classList.toggle("hide", v !== "todas");
  $("card-lista").classList.toggle("hide", !(v === "todas" || v === "pessoa"));
  $("pessoas").classList.toggle("hide", v !== "pessoas");
  $("linhas").classList.toggle("hide", v !== "linhas");
  $("painel").classList.toggle("hide", v !== "painel");
  const ativa = v === "todas" ? "" : v === "pessoa" ? (pessoaSel === me ? "minhas" : "pessoas") : v;
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("on", t.dataset.vista === ativa));
  if (v === "todas") preencherAbertura(false);
  migalhas(); render();
}
document.querySelector(".tabs").addEventListener("click", (ev) => {
  const v = ev.target.dataset && ev.target.dataset.vista; if (!v) return;
  if (v === "minhas") { vista = "pessoa"; pessoaSel = me; } else { vista = v; pessoaSel = null; }
  mostrarVista();
});
$("pastas").addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-pessoa]"); if (!b) return;
  vista = "pessoa"; pessoaSel = b.dataset.pessoa; mostrarVista();
});

// ---------- filtros ----------
function noPeriodo(o, p, de, ate) {
  if (p === "tudo") return true;
  const d = new Date(o.inicioEm); if (isNaN(d)) return false;
  const n = new Date(); let ini = null, fim = null;
  if (p === "hoje") ini = new Date(n.getFullYear(), n.getMonth(), n.getDate());
  else if (p === "7") ini = new Date(Date.now() - 7 * 864e5);
  else if (p === "30") ini = new Date(Date.now() - 30 * 864e5);
  else if (p === "mes") ini = new Date(n.getFullYear(), n.getMonth(), 1);
  else { if (de) ini = new Date(de + "T00:00"); if (ate) fim = new Date(ate + "T23:59"); }
  return (!ini || d >= ini) && (!fim || d <= fim);
}
const dur = (m) => { const d = Math.floor(m / 1440), hh = Math.floor((m % 1440) / 60), n = m % 60; return (d ? d + "d " : "") + (hh ? hh + "h " : "") + n + "min"; };
function emAlerta(o) {
  const lim = Number($("alerta").value) || 0;
  if (!lim || !aberta(o)) return false;
  const m = minutos(o); return m !== null && m >= lim * 60;
}
function visiveis() {
  const q = ($("busca").value || "").toLowerCase(), f = $("filtro").value, fl = $("f-linha").value;
  return escopo().filter((o) => {
    if (f === "paradas" && !aberta(o)) return false;
    if (f === "consertadas" && aberta(o)) return false;
    if (fl && o.linha !== fl) return false;
    if (!noPeriodo(o, $("periodo").value, $("de").value, $("ate").value)) return false;
    if (!q) return true;
    return [o.linha, o.posto, o.ocorrencia, o.acao, o.responsavel, o.criadoNome, o.criadoEmail].join(" ").toLowerCase().includes(q);
  }).sort((x, y) => String(y.inicioEm).localeCompare(String(x.inicioEm)));
}
function contagem() {
  const base = escopo(), p = base.filter(aberta).length, al = base.filter(emAlerta).length;
  $("cont").textContent = `${base.length} no total · ${p} em aberto · ${base.length - p} finalizadas` + (al ? ` · ⚠ ${al} em alerta` : "");
}
["busca", "filtro", "f-linha", "de", "ate"].forEach((id) => $(id).addEventListener(id === "busca" ? "input" : "change", render));
$("periodo").addEventListener("change", () => { $("custom").classList.toggle("hide", $("periodo").value !== "custom"); render(); });
$("p-periodo").addEventListener("change", render);

// ---------- linhas e postos ----------
function renderLinhas() {
  const mapa = new Map();
  docs.forEach((o) => {
    if (!o.linha) return;
    const k = numKey(o.linha); if (!mapa.has(k)) mapa.set(k, { nome: o.linha, postos: new Map(), n: 0, p: 0 });
    const L = mapa.get(k); L.n++; if (aberta(o)) L.p++;
    const pk = numKey(o.posto || "") || "?"; if (!L.postos.has(pk)) L.postos.set(pk, { nome: o.posto || "—", n: 0, p: 0 });
    const P = L.postos.get(pk); P.n++; if (aberta(o)) P.p++;
  });
  const box = $("linhas-grid"); box.textContent = ""; $("sem-linhas").classList.toggle("hide", mapa.size > 0);
  [...mapa.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")).forEach((L) => {
    const c = h("article", "maq" + (L.p ? " parada" : "")), st = h("span", "st" + (L.p ? "" : " ok"));
    st.append(h("i"), L.p ? `${L.p} em aberto` : "Sem ocorrência aberta");
    const chips = h("div", "chips");
    [...L.postos.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")).forEach((P) => chips.appendChild(h("span", "chip" + (P.p ? " aberto" : ""), P.nome + (P.p ? ` (${P.p})` : ""))));
    const ac = h("div", "acoes");
    const b1 = h("button", "btn small", "Abrir ocorrência"); b1.type = "button"; b1.dataset.reg = L.nome;
    const b2 = h("button", "btn small", "Ver ocorrências"); b2.type = "button"; b2.dataset.ver = L.nome;
    ac.append(b1, b2);
    c.append(h("h3", "", L.nome), st, h("p", "muted", L.n + (L.n === 1 ? " ocorrência" : " ocorrências")), chips, ac); box.appendChild(c);
  });
}
$("linhas-grid").addEventListener("click", (ev) => {
  const d = ev.target.dataset || {};
  if (d.reg) { vista = "todas"; pessoaSel = null; mostrarVista(); $("linha").value = d.reg; atualizarListas(); $("posto").focus(); $("card-novo").scrollIntoView({ behavior: "smooth" }); }
  if (d.ver) { vista = "todas"; pessoaSel = null; $("busca").value = d.ver; mostrarVista(); }
});
function imprimir(el) {
  document.querySelectorAll(".imp-alvo").forEach((x) => x.classList.toggle("ativo", x === el));
  document.body.classList.add("imprimindo");
  const fim = () => { document.body.classList.remove("imprimindo"); window.removeEventListener("afterprint", fim); };
  window.addEventListener("afterprint", fim); setTimeout(() => window.print(), 150);
}

// ---------- painel ----------
function barras(titulo, itens) {
  const s = h("section", "grafico"); s.appendChild(h("h3", "", titulo));
  if (!itens.length) { s.appendChild(h("p", "muted", "Sem dados no período.")); return s; }
  const max = Math.max(...itens.map((i) => i[1]));
  itens.forEach(([r, v]) => {
    const l = h("div", "lin"), b = h("div", "barra"), i = h("i"); i.style.width = Math.max(4, (v / max) * 100) + "%"; b.appendChild(i);
    l.append(h("span", "rot", r), b, h("b", "", String(v))); s.appendChild(l);
  });
  return s;
}
function renderPainel() {
  const base = docs.filter((o) => noPeriodo(o, $("p-periodo").value)), box = $("painel-corpo"); box.textContent = "";
  const fin = base.filter((o) => !aberta(o)), tm = fin.length ? Math.round(fin.reduce((s, o) => s + (minutos(o) || 0), 0) / fin.length) : null;
  const kp = h("div", "kpis");
  [["Ocorrências no período", base.length], ["Em aberto agora", docs.filter(aberta).length], ["Tempo médio até finalizar", tm === null ? "—" : dur(tm)], ["Em alerta", docs.filter(emAlerta).length]]
    .forEach(([r, v]) => { const k = h("div", "kpi"); k.append(h("b", "", String(v)), h("span", "", r)); kp.appendChild(k); });
  box.appendChild(kp);
  const cont = (fn) => { const m = new Map(); base.forEach((o) => { const [k, r] = fn(o); if (!m.has(k)) m.set(k, [r, 0]); m.get(k)[1]++; }); return [...m.values()].sort((a, b) => b[1] - a[1]); };
  box.appendChild(barras("Postos com mais ocorrências", cont((o) => [numKey((o.linha || "") + (o.posto || "")) || "?", (o.linha || "—") + " · " + (o.posto || "—")]).slice(0, 6)));
  box.appendChild(barras("Linhas com mais ocorrências", cont((o) => [numKey(o.linha || "") || "?", o.linha || "—"]).slice(0, 6)));
  const ini = (d) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
  const hoje = ini(new Date()), sem = [];
  for (let i = 7; i >= 0; i--) { const d = new Date(hoje); d.setDate(d.getDate() - 7 * i); sem.push([d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }), 0, d.getTime()]); }
  docs.forEach((o) => { const d = new Date(o.inicioEm); if (isNaN(d)) return; const s = sem.find((x) => x[2] === ini(d).getTime()); if (s) s[1]++; });
  box.appendChild(barras("Ocorrências por semana (últimas 8, início na segunda)", sem.map((s) => [s[0], s[1]])));
}

// ---------- pessoas ----------
function renderPastas() {
  const mapa = {}, ordem = [];
  docs.forEach((o) => {
    const k = o.criadoPor || "sem-autor";
    if (!mapa[k]) { mapa[k] = { nome: o.criadoNome || "Autor desconhecido", email: o.criadoEmail || "", n: 0, p: 0 }; ordem.push(k); }
    mapa[k].n++; if (aberta(o)) mapa[k].p++;
  });
  const box = $("pastas"); box.textContent = "";
  $("sem-pessoas").classList.toggle("hide", ordem.length > 0);
  ordem.sort((a, b) => mapa[a].nome.localeCompare(mapa[b].nome, "pt-BR")).forEach((k) => {
    const m = mapa[k], b = h("button", "pasta"); b.type = "button"; b.dataset.pessoa = k;
    b.append(h("b", "", "📁 " + m.nome + (k === me ? " (você)" : "")), h("small", "", m.email),
      h("small", "", `${m.n} ${m.n === 1 ? "ocorrência" : "ocorrências"} · ${m.p} em aberto`));
    box.appendChild(b);
  });
}

// ---------- cartões ----------
function inp(o, campo, tipo, valor, rot, ph, lista) {
  const i = h("input"); i.type = tipo; i.value = valor || ""; i.setAttribute("aria-label", rot);
  i.dataset.id = o.id; i.dataset.campo = campo; if (ph) i.placeholder = ph; if (lista) i.setAttribute("list", lista);
  if (tipo === "datetime-local") { i.min = MIN; i.max = agora(); }
  if (tipo === "date") { i.min = MIN.slice(0, 10); i.max = hojeStr(); }
  return i;
}
const bloco = (rot, node) => { const f = h("div", "f"); f.append(h("span", "", rot), node); return f; };
const ptxt = (s) => h("p", "", s || "—");

function preencherAtv(id, l) {
  l = l || $("atv-" + id); if (!l) return; l.textContent = "";
  const itens = atv[id];
  if (!itens) { l.appendChild(h("p", "muted", "Carregando…")); return; }
  if (!itens.length) { l.appendChild(h("p", "muted", "Nada por aqui ainda.")); return; }
  itens.forEach((a) => {
    const r = h("div", "atv-item " + (a.tipo || ""));
    r.append(h("b", "", a.autorNome || "—"), h("span", "muted", " · " + fmt(a.em)), h("p", "", a.texto || ""));
    l.appendChild(r);
  });
  l.scrollTop = l.scrollHeight;
}
function painelAtv(id) {
  const p = h("div", "atv"), l = h("div", "atv-lista"); l.id = "atv-" + id; p.appendChild(l);
  const f = h("div", "atv-form"), i = h("input"); i.type = "text"; i.maxLength = 500; i.placeholder = "Escreva um comentário";
  i.dataset.comentario = id; i.setAttribute("aria-label", "Comentário");
  const b = h("button", "btn small", "Enviar"); b.type = "button"; b.dataset.enviar = id;
  f.append(i, b); p.appendChild(f); preencherAtv(id, l); return p;
}
function abrirAtv(id) {
  abertos.add(id);
  if (!atvUnsub[id]) atvUnsub[id] = onSnapshot(query(collection(db, "ocorrencias", id, "atividade"), orderBy("em")),
    (s) => { atv[id] = s.docs.map((d) => d.data()); preencherAtv(id); }, () => { atv[id] = []; preencherAtv(id); });
}
function fecharAtv(id) { abertos.delete(id); if (atvUnsub[id]) { atvUnsub[id](); delete atvUnsub[id]; } delete atv[id]; }

function cartao(o) {
  const meu = o.criadoPor === me, fin = !aberta(o), al = emAlerta(o);
  const c = h("article", "oc" + (fin ? " ok" : "") + (al ? " alerta" : ""));
  const head = h("div", "oc-head"), info = h("div", "oc-info"), st = h("span", "st" + (fin ? " ok" : ""));
  head.appendChild(h("h2", "", (o.linha || "—") + " · " + (o.posto || "—")));
  st.append(h("i"), fin ? "Finalizada" : "Em aberto"); info.appendChild(st);
  if (al) info.appendChild(h("span", "aviso", "⚠ Aberta há " + dur(minutos(o))));
  else info.appendChild(h("span", "tempo", "Duração: " + (tempo(o) || "—")));
  head.appendChild(info); c.appendChild(head);
  const g = h("div", "oc-grid");
  g.append(
    bloco("Data", meu ? inp(o, "data", "date", dataDe(o), "Data") : ptxt(fmtData(dataDe(o)))),
    bloco("Início", meu ? inp(o, "inicio", "time", horaDe(o), "Início") : ptxt(horaDe(o))),
    bloco("Linha", meu ? inp(o, "linha", "text", o.linha, "Linha", null, "linhas-lista") : ptxt(o.linha)),
    bloco("Posto", meu ? inp(o, "posto", "text", o.posto, "Posto", null, "postos-lista") : ptxt(o.posto)),
    bloco("Ocorrência", meu ? inp(o, "ocorrencia", "text", o.ocorrencia, "Ocorrência") : ptxt(o.ocorrencia)),
    bloco("Ação da ocorrência", inp(o, "acao", "text", o.acao, "Ação da ocorrência", "Ex.: trocou a válvula")),
    bloco("Fim da ocorrência", inp(o, "fimEm", "datetime-local", o.fimEm, "Fim da ocorrência")),
    bloco("Responsável pela ocorrência", inp(o, "responsavel", "text", o.responsavel, "Responsável pela ocorrência", null, "resp-lista"))
  );
  c.appendChild(g);
  const foot = h("div", "oc-foot"), ac = h("div", "acoes");
  const btn = (t, k, cls) => { const b = h("button", "btn small" + (cls ? " " + cls : ""), t); b.type = "button"; b.dataset[k] = o.id; ac.appendChild(b); };
  if (!fin) btn("Finalizar agora", "finalizar", "func"); else btn("Reabrir", "reabrir");
  btn("Copiar resumo", "copiar"); btn(abertos.has(o.id) ? "Ocultar atividade" : "Comentários e histórico", "atv");
  if (meu) btn("Apagar", "apagar");
  foot.append(h("span", "", "Aberta por " + (o.criadoNome || "—") + (o.criadoEmail ? " · " + o.criadoEmail : "")), ac);
  c.appendChild(foot);
  if (abertos.has(o.id)) c.appendChild(painelAtv(o.id));
  return c;
}
function render() {
  const a = document.activeElement;
  if (a && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName) && a.closest("#corpo")) { adiado = true; return; }
  adiado = false;
  if (!me) return;
  atualizarListas();
  if (vista === "pessoas") { renderPastas(); return; }
  if (vista === "linhas") { renderLinhas(); return; }
  if (vista === "painel") { renderPainel(); return; }
  $("h-lista").textContent = vista === "pessoa" ? "Ocorrências de " + nomePessoa(pessoaSel) : "Ocorrências";
  const corpo = $("corpo"); corpo.textContent = "";
  const lista = visiveis(); contagem();
  $("vazio").classList.toggle("hide", lista.length > 0);
  lista.forEach((o) => corpo.appendChild(cartao(o)));
}
setInterval(() => { if (me) render(); }, 60000);

// ---------- ações ----------
async function copiar(id, btn) {
  const o = docs.find((x) => x.id === id); if (!o) return;
  const t = `Data: ${fmtData(dataDe(o))}\nInício: ${horaDe(o)}\nLinha: ${o.linha || "-"}\nPosto: ${o.posto || "-"}\nOcorrência: ${o.ocorrencia || "-"}\nAção da ocorrência: ${o.acao || "-"}\nFim da ocorrência: ${fmt(o.fimEm) || "-"}\nResponsável pela ocorrência: ${o.responsavel || "-"}\nAberta por: ${o.criadoNome || "-"}${o.criadoEmail ? " (" + o.criadoEmail + ")" : ""}`;
  try { await navigator.clipboard.writeText(t); btn.textContent = "Copiado"; } catch (_) { btn.textContent = "Não copiou"; }
  setTimeout(() => { btn.textContent = "Copiar resumo"; }, 1800);
}
const ROTULOS = { data: "Data", inicio: "Início", linha: "Linha", posto: "Posto", ocorrencia: "Ocorrência", acao: "Ação da ocorrência", fimEm: "Fim da ocorrência", responsavel: "Responsável pela ocorrência" };
const verCampo = (c, v) => (c === "fimEm" ? fmt(v) : v) || "—";
async function salvar(id, patch, texto) {
  const b = writeBatch(db);
  b.update(doc(db, "ocorrencias", id), patch);
  b.set(doc(collection(db, "ocorrencias", id, "atividade")), { tipo: "mudanca", texto, autorId: me, autorNome: perfil.nome, em: Date.now() });
  await b.commit();
}
$("corpo").addEventListener("change", async (ev) => {
  const t = ev.target; if (!t.dataset.campo) return;
  const campo = t.dataset.campo, id = t.dataset.id, novo = t.value.trim(), o = docs.find((x) => x.id === id) || {};
  let patch, antes, depois;
  if (campo === "data" || campo === "inicio") {
    const d = campo === "data" ? novo : dataDe(o), hh = campo === "inicio" ? novo : horaDe(o);
    if (!d || !hh) { $("xerr").textContent = "Data e início não podem ficar vazios."; adiado = true; return; }
    patch = { inicioEm: d + "T" + hh };
    if (patch.inicioEm === o.inicioEm) return;
    antes = campo === "data" ? fmtData(dataDe(o)) : horaDe(o); depois = campo === "data" ? fmtData(d) : hh;
  } else {
    if (novo === (o[campo] || "")) return;
    if (!novo && ["linha", "posto", "ocorrencia"].includes(campo)) { $("xerr").textContent = "Linha, posto e ocorrência não podem ficar vazios."; adiado = true; return; }
    patch = { [campo]: novo }; antes = verCampo(campo, o[campo]); depois = verCampo(campo, novo);
  }
  if (patch.inicioEm || campo === "fimEm") {
    const md = checarDatas(patch.inicioEm || o.inicioEm, campo === "fimEm" ? novo : o.fimEm);
    if (md) { $("xerr").textContent = md; adiado = true; return; }
  }
  $("xerr").textContent = "";
  try { await salvar(id, patch, `${ROTULOS[campo]}: ${antes} → ${depois}`); }
  catch (_) { $("xerr").textContent = "Não foi possível salvar a alteração. Confira a internet e tente de novo."; adiado = true; }
});
$("corpo").addEventListener("focusout", () => setTimeout(() => { if (adiado) render(); }, 150));
async function enviarComentario(id) {
  const i = document.querySelector(`[data-comentario="${id}"]`), texto = i ? i.value.trim() : ""; if (!texto) return;
  try { await addDoc(collection(db, "ocorrencias", id, "atividade"), { tipo: "comentario", texto, autorId: me, autorNome: perfil.nome, em: Date.now() }); i.value = ""; }
  catch (_) { $("xerr").textContent = "Não foi possível enviar o comentário."; }
}
$("corpo").addEventListener("keydown", (ev) => { if (ev.key === "Enter" && ev.target.dataset && ev.target.dataset.comentario) enviarComentario(ev.target.dataset.comentario); });
$("corpo").addEventListener("click", async (ev) => {
  const d = ev.target.dataset || {};
  if (d.copiar) { copiar(d.copiar, ev.target); return; }
  if (d.enviar) { enviarComentario(d.enviar); return; }
  if (d.atv) { if (abertos.has(d.atv)) fecharAtv(d.atv); else abrirAtv(d.atv); render(); return; }
  if (d.finalizar) {
    const o = docs.find((x) => x.id === d.finalizar); if (!o) return;
    if (!confirm(`Finalizar a ocorrência de ${o.linha || ""} · ${o.posto || ""} agora? O fim será registrado com a data e a hora atuais.`)) return;
    const p = { fimEm: agora() };
    if (!o.responsavel) p.responsavel = perfil.nome;
    const md = checarDatas(o.inicioEm, p.fimEm);
    if (md) { $("xerr").textContent = md; return; }
    try { await salvar(d.finalizar, p, "Finalizou a ocorrência"); $("xerr").textContent = ""; }
    catch (_) { $("xerr").textContent = "Não foi possível finalizar. Confira a internet e tente de novo."; }
    return;
  }
  if (d.reabrir) {
    if (!confirm("Reabrir esta ocorrência? Ela volta a ficar em aberto.")) return;
    try { await salvar(d.reabrir, { fimEm: "", responsavel: "" }, "Reabriu a ocorrência (fim e responsável apagados)"); $("xerr").textContent = ""; }
    catch (_) { $("xerr").textContent = "Não foi possível reabrir."; }
    return;
  }
  if (d.apagar && confirm("Apagar esta ocorrência para todos?")) {
    try { fecharAtv(d.apagar); await deleteDoc(doc(db, "ocorrencias", d.apagar)); } catch (_) { $("xerr").textContent = "Não foi possível apagar."; }
  }
});

$("form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const data = $("data").value, hora = $("inicio").value, linha = $("linha").value.trim(), posto = $("posto").value.trim();
  const oc = $("ocorr").value.trim(), acao = $("acao").value.trim(), fim = $("fim").value, resp = $("resp").value.trim(), fe = $("ferr");
  fe.textContent = "";
  if (!data || !hora || !linha || !posto || !oc) { fe.textContent = "Preencha data, início, linha, posto e ocorrência."; return; }
  const ini = data + "T" + hora, md = checarDatas(ini, fim); if (md) { fe.textContent = md; return; }
  try {
    const ref = doc(collection(db, "ocorrencias")), b = writeBatch(db);
    b.set(ref, { inicioEm: ini, linha, posto, ocorrencia: oc, acao, fimEm: fim, responsavel: resp, criadoPor: me, criadoNome: perfil.nome, criadoEmail: perfil.email, criadoEm: Date.now() });
    b.set(doc(collection(ref, "atividade")), { tipo: "mudanca", texto: "Ocorrência aberta", autorId: me, autorNome: perfil.nome, em: Date.now() });
    await b.commit();
    $("form").reset(); preencherAbertura(true);
  } catch (_) { fe.textContent = "Não foi possível registrar. Confira a internet e tente de novo."; }
});

// ---------- exportar .xlsx e PDF ----------
if (NATIVO) $("pdf").classList.add("hide");
$("xlsx").addEventListener("click", async () => {
  const xe = $("xerr"); xe.textContent = "";
  const linhas = visiveis().map((o) => { const m = minutos(o); return {
    "Situação": aberta(o) ? "Em aberto" : "Finalizada", "Data": fmtData(dataDe(o)), "Início": horaDe(o), "Linha": o.linha || "", "Posto": o.posto || "",
    "Ocorrência": o.ocorrencia || "", "Ação da ocorrência": o.acao || "", "Fim da ocorrência": fmt(o.fimEm), "Responsável pela ocorrência": o.responsavel || "",
    "Duração": tempo(o), "Duração (min)": m === null ? "" : m, "Aberta por": o.criadoNome || "", "E-mail de quem abriu": o.criadoEmail || "" }; });
  if (!linhas.length) { xe.textContent = "Não há ocorrências para exportar."; return; }
  try {
    const ws = XLSX.utils.json_to_sheet(linhas);
    ws["!cols"] = [12, 12, 8, 16, 16, 34, 34, 20, 26, 16, 14, 22, 28].map((w) => ({ wch: w }));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Ocorrências");
    await salvarPlanilha(wb, "ocorrencias-" + new Date().toISOString().slice(0, 10) + ".xlsx");
  } catch (e) { if (!/cancel/i.test(String((e && e.message) || ""))) xe.textContent = "Não foi possível exportar. Tente de novo."; }
});
$("pdf").addEventListener("click", () => {
  const lista = visiveis(), box = $("relatorio"); box.textContent = "";
  if (!lista.length) { $("xerr").textContent = "Não há ocorrências para o relatório."; return; }
  $("xerr").textContent = "";
  const p = lista.filter(aberta).length;
  box.append(h("h1", "", "Máquina em Dia — Relatório de ocorrências"),
    h("p", "", `Gerado em ${fmt(new Date())} por ${perfil.nome}. ${lista.length} ocorrência(s): ${p} em aberto e ${lista.length - p} finalizada(s). Reflete os filtros aplicados na tela.`));
  const t = h("table"), hd = h("tr");
  ["Data", "Início", "Linha", "Posto", "Ocorrência", "Ação da ocorrência", "Fim da ocorrência", "Responsável", "Duração"].forEach((x) => hd.appendChild(h("th", "", x)));
  t.appendChild(hd);
  lista.forEach((o) => { const r = h("tr"); [fmtData(dataDe(o)), horaDe(o), o.linha, o.posto, o.ocorrencia, o.acao, fmt(o.fimEm), o.responsavel, tempo(o)].forEach((x) => r.appendChild(h("td", "", x || "—"))); t.appendChild(r); });
  box.appendChild(t); imprimir(box);
});
