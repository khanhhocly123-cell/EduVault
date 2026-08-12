/* Phần dùng chung của bộ đọc LaTeX: bảng ký hiệu + bộ tách token.
 *
 * Tách ra vì có HAI bộ dựng ăn chung một nguồn:
 *   app.js   → HTML để hiện trên màn hình
 *   omml.js  → OMML để nhét vào file Word
 *
 * Hai bên mà giữ hai bảng ký hiệu riêng thì kiểu gì cũng lệch, và lệch kiểu
 * tệ nhất: trên web nhìn đúng, mở Word ra mới thấy sai — lúc đó đề đã in rồi.
 */

export const SYM = {
  alpha:"α", beta:"β", gamma:"γ", delta:"δ", epsilon:"ε", varepsilon:"ε", zeta:"ζ",
  eta:"η", theta:"θ", vartheta:"ϑ", iota:"ι", kappa:"κ", lambda:"λ", mu:"μ", nu:"ν",
  xi:"ξ", rho:"ρ", varrho:"ϱ", sigma:"σ", tau:"τ", upsilon:"υ", phi:"ϕ", varphi:"φ",
  chi:"χ", psi:"ψ", omega:"ω", pi:"π", varpi:"ϖ",
  Gamma:"Γ", Delta:"Δ", Theta:"Θ", Lambda:"Λ", Xi:"Ξ", Pi:"Π", Sigma:"Σ",
  Upsilon:"Υ", Phi:"Φ", Psi:"Ψ", Omega:"Ω",
  ell:"ℓ", infty:"∞", partial:"∂", nabla:"∇", angle:"∠", triangle:"△", square:"□",
  circ:"∘", degree:"°", prime:"′", cdot:"·", cdots:"⋯", ldots:"…", dots:"…",
  times:"×", div:"÷", pm:"±", mp:"∓", ast:"∗", star:"⋆", bullet:"∙",
  leq:"≤", le:"≤", geq:"≥", ge:"≥", neq:"≠", ne:"≠", approx:"≈", equiv:"≡",
  sim:"∼", simeq:"≃", cong:"≅", propto:"∝", ll:"≪", gg:"≫",
  to:"→", rightarrow:"→", Rightarrow:"⇒", leftarrow:"←", Leftarrow:"⇐",
  leftrightarrow:"↔", Leftrightarrow:"⇔", mapsto:"↦", longrightarrow:"⟶",
  in:"∈", notin:"∉", ni:"∋", subset:"⊂", subseteq:"⊆", supset:"⊃", supseteq:"⊇",
  cup:"∪", cap:"∩", setminus:"∖", emptyset:"∅", varnothing:"∅",
  forall:"∀", exists:"∃", neg:"¬", land:"∧", lor:"∨",
  perp:"⊥", parallel:"∥", mid:"∣", nmid:"∤", cdotp:"·",
  langle:"⟨", rangle:"⟩", lbrace:"{", rbrace:"}", vert:"|", Vert:"‖",
  backslash:"\\", "%":"%", "&":"&", "#":"#", "$":"$", "_":"_", "{":"{", "}":"}",
  "'":"′"
};

/** Khoảng trắng của TeX. `\!` là lùi âm, ta chỉ cần bỏ qua. */
export const SPACE = { ",":" ", ";":" ", ":":" ", "!":"", " ":" ",
                       quad:" ", qquad:"  ", enspace:" " };

/** Tên hàm phải đứng thẳng: sin x chứ không phải s·i·n·x. */
export const FUNC = new Set(["sin","cos","tan","cot","sec","csc","arcsin","arccos","arctan",
  "sinh","cosh","tanh","log","ln","lg","exp","lim","limsup","liminf","max","min",
  "sup","inf","det","dim","gcd","deg","arg","mod","Pr"]);

/** Lệnh đổi sang chữ đứng. */
export const UPRIGHT = new Set(["mathrm","text","textrm","textnormal","operatorname",
  "mathbf","mathsf","mathbb","mathcal","mathfrak","rm"]);

export const ACCENT = { vec:"vec", overrightarrow:"vec", overline:"ovl", bar:"ovl",
                        hat:"hat", widehat:"hat", tilde:"tld", widetilde:"tld" };

export const BIGOP = { int:"∫", iint:"∬", oint:"∮", sum:"∑", prod:"∏",
                       bigcup:"⋃", bigcap:"⋂" };

/**
 * Tách chuỗi LaTeX thành token. Bốn loại:
 *   {k:"cmd", v}  lệnh — \alpha, \frac, \,
 *   {k:"ch",  v}  một ký tự thường
 *   {k:"{"} {k:"}"} {k:"^"} {k:"_"}
 */
export function tokenize(s){
  const out = [];
  let i = 0;
  while(i < s.length){
    const c = s[i];
    if(c === "\\"){
      const word = /^[a-zA-Z]+/.exec(s.slice(i+1));
      if(word){
        out.push({ k:"cmd", v:word[0] });
        i += 1 + word[0].length;
        while(s[i] === " ") i++;      // TeX nuốt khoảng trắng sau lệnh chữ
      } else {
        out.push({ k:"cmd", v:s[i+1] ?? "" });
        i += 2;
      }
    } else if(c === "{" || c === "}" || c === "^" || c === "_"){
      out.push({ k:c }); i++;
    } else {
      out.push({ k:"ch", v:c }); i++;
    }
  }
  return out;
}
