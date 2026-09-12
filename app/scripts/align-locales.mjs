import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const I18N_DIR = path.resolve(import.meta.dirname, '../src/i18n');

// Standard localized translations for the missing sections across languages
const TRANSLATIONS = {
  de: {
    menubar: {
      paragraph: 'Absatz', format: 'Format', themes: 'Designs', tools: 'Werkzeuge',
      exportHtml: 'Als HTML exportieren', exportDocx: 'Als Word (DOCX) exportieren', exportPdf: 'Als PDF exportieren',
      exportPdfPrint: 'Drucken / PDF exportieren…', exportImage: 'Als langes Bild exportieren',
      copyMarkdown: 'Markdown-Quelltext kopieren', copyHtml: 'Formatiertes HTML kopieren', copyImage: 'Bild in Zwischenablage kopieren',
      preferences: 'Einstellungen…', find: 'Suchen', replace: 'Ersetzen',
      h1: 'Überschrift 1 (H1)', h2: 'Überschrift 2 (H2)', h3: 'Überschrift 3 (H3)', h4: 'Überschrift 4 (H4)', h5: 'Überschrift 5 (H5)', h6: 'Überschrift 6 (H6)',
      paragraphText: 'Fließtext-Absatz', bulletList: 'Aufzählungsliste', numberedList: 'Nummerierte Liste', taskList: 'Aufgabenliste',
      insertTable: 'Tabelle einfügen', blockquote: 'Zitatblock', codeBlock: 'Code-Block', mathBlock: 'Formel-Block',
      horizontalRule: 'Trennlinie', bold: 'Fett', italic: 'Kursiv', underline: 'Unterstrichen', strikethrough: 'Durchgestrichen',
      inlineCode: 'Inline-Code', inlineMath: 'Inline-Formel', insertLink: 'Link einfügen',
      insertImage: 'Lokales Bild einfügen…', insertWebImage: 'Bild-URL einfügen…',
      cleanAI: 'KI-Spuren bereinigen', aiRewrite: 'KI-Umschreiben',
      editMode: 'Bearbeitungsmodus', readingMode: 'Lesemodus', sourceMode: 'Quellcode-Modus', splitView: 'Geteilte Ansicht',
      fileTreeSidebar: 'Dateibaum-Seitenleiste', docOutline: 'Dokumentgliederung', globalSearchMenu: 'Globale Suche',
      toggleSourceMode: 'Bearbeiten / Quellcode umschalten', focusMode: 'Fokus-Modus', typewriterMode: 'Schreibmaschinen-Modus',
      fullscreen: 'Vollbild', limitEditorWidth: 'Editor-Breite begrenzen', customTheme: 'Benutzerdefiniert',
      aiAgent: 'Catstep KI-Assistent', cjkProofread: 'CJK-Korrekturlesen', cmdPalette: 'Befehlspalette', pomodoro: 'Catstep Fokus'
    },
    common: {
      close: 'Schließen', cancel: 'Abbrechen', save: 'Speichern', back: 'Zurück', done: 'Fertig', ok: 'OK', delete: 'Löschen', edit: 'Bearbeiten', copy: 'Kopieren'
    },
    panel: {
      expand: 'Bereich erweitern', collapse: 'Bereich einklappen', close: 'Bereich schließen'
    },
    find: {
      find: 'Suchen', replace: 'Ersetzen', findPlaceholder: 'Im Dokument suchen...', replacePlaceholder: 'Ersetzen durch...',
      next: 'Weiter', previous: 'Zurück', all: 'Alle auswählen', matchCase: 'Groß-/Kleinschreibung', byWord: 'Ganzes Wort',
      regexp: 'Regulärer Ausdruck', replaceBtn: 'Ersetzen', replaceAll: 'Alle ersetzen', close: 'Schließen'
    },
    outline: {
      heading: 'Gliederung', close: 'Gliederung schließen', empty: 'Keine Überschriften', expandSection: 'Abschnitt erweitern',
      collapseSection: 'Abschnitt einklappen', jumpHint: '{key} zum Springen drücken', lineJumpHint: 'Eingabe ↵ Springen · Esc Abbrechen',
      numberJumpHint: 'Zahl → Springen · g+Ziffern → Zeile', letterJumpHint: 'Buchstabe → Springen · g+Ziffern → Zeile',
      filterPlaceholder: 'Überschriften filtern...', filterDepth: 'Tiefe', filterDepthAll: 'Alle Ebenen (H1-H6)',
      filterDepthH2: 'Nur H1-H2', filterDepthH3: 'Nur H1-H3', collapseAll: 'Alle einklappen', expandAll: 'Alle ausklappen',
      scrollToActive: 'Aktuelle Überschrift anzeigen', clearFilter: 'Filter löschen', noMatchingHeadings: 'Keine passenden Überschriften',
      headingCount: '{count} Überschriften', filteredCount: '{matched} / {total} Überschriften'
    },
    commandPalette: {
      placeholder: 'Befehl, Format oder Tastenkürzel eingeben…', empty: 'Kein passender Befehl',
      emptyHint: 'Suchen Sie nach fett, tabelle, überschrift oder ansicht', navigate: 'Navigieren', execute: 'Ausführen', close: 'Schließen',
      totalCommands: '{n} Befehle insgesamt', matchingCommands: '{n} passende Befehle'
    },
    editorCtx: {
      cut: 'Ausschneiden', copy: 'Kopieren', copyAs: 'Kopieren als', copyAsMarkdown: 'Als Markdown kopieren',
      copyAsHtml: 'Als HTML-Code kopieren', copyAsPlainText: 'Als Nur-Text kopieren', paste: 'Einfügen', pasteAsPlainText: 'Als Nur-Text einfügen',
      selectAll: 'Alles auswählen', table: 'Tabelle', insertRowAbove: 'Zeile oberhalb einfügen', insertRowBelow: 'Zeile unterhalb einfügen',
      deleteRow: 'Zeile löschen', insertColLeft: 'Spalte links einfügen', insertColRight: 'Spalte rechts einfügen', deleteCol: 'Spalte löschen',
      alignLeft: 'Linksbündig', alignCenter: 'Zentriert', alignRight: 'Rechtsbündig', openTableEditor: 'Tabelleneditor öffnen', deleteTable: 'Tabelle löschen',
      openLink: 'Link öffnen', copyLinkAddress: 'Link-Adresse kopieren', editLink: 'Link bearbeiten', copyImagePath: 'Bildpfad kopieren',
      copyLatex: 'LaTeX-Quelltext kopieren', editFormula: 'Im Formeleditor bearbeiten', copyCodeContent: 'Code-Inhalt kopieren',
      aiAssistant: 'Catstep KI-Assistent', aiPolish: 'Stil verbessern', aiExpand: 'Erweitern & Ausführen', aiFix: 'Grammatik korrigieren',
      aiDeAI: 'KI-Muster vermenschlichen', transformCase: 'Groß-/Kleinschreibung ändern', uppercase: 'GROSSBUCHSTABEN', lowercase: 'kleinbuchstaben',
      titleCase: 'Wortanfänge Groß', selectionStats: '{chars} Zeichen, {words} Wörter', insert: 'Einfügen', insertTable: 'Tabelle',
      insertCodeBlock: 'Code-Block', insertMathBlock: 'Formel-Block', insertQuote: 'Zitat', insertLink: 'Link', insertImage: 'Bild...',
      insertImageUrl: 'Bild aus URL...', insertHorizontalLine: 'Trennlinie', insertBulletList: 'Aufzählung', insertNumberedList: 'Nummerierte Liste',
      insertTaskList: 'Aufgabenliste', format: 'Format', bold: 'Fett', italic: 'Kursiv', underline: 'Unterstrichen', strikethrough: 'Durchgestrichen',
      inlineCode: 'Inline-Code', inlineMath: 'Inline-Formel', highlight: 'Hervorheben', clearFormat: 'Formatierung löschen',
      paragraph: 'Absatz', heading1: 'Überschrift 1', heading2: 'Überschrift 2', heading3: 'Überschrift 3', heading4: 'Überschrift 4',
      heading5: 'Überschrift 5', heading6: 'Überschrift 6', normalParagraph: 'Normaler Absatz', promoteHeading: 'Ebene heraufstufen',
      demoteHeading: 'Ebene herabstufen', select: 'Auswählen', selectWord: 'Wort auswählen', selectLine: 'Zeile auswählen', selectParagraph: 'Absatz auswählen',
      findAndReplace: 'Suchen und Ersetzen...'
    },
    unsaved: {
      title: 'Nicht gespeicherte Änderungen',
      prompt: 'Möchten Sie die Änderungen an dieser Datei speichern?',
      windowPrompt: 'Es gibt {count} nicht gespeicherte Dateien. Änderungen speichern?',
      discardWarning: 'Wenn Sie nicht speichern, gehen die Änderungen seit dem letzten Speichern verloren.',
      modifiedBadge: 'Geändert',
      message: '{file} wurde geändert. Änderungen speichern?',
      save: 'Speichern',
      dontSave: 'Nicht speichern',
      cancel: 'Abbrechen',
    }
  },
  fr: {
    menubar: {
      paragraph: 'Paragraphe', format: 'Format', themes: 'Thèmes', tools: 'Outils',
      exportHtml: 'Exporter en HTML', exportDocx: 'Exporter en Word (DOCX)', exportPdf: 'Exporter en PDF',
      exportPdfPrint: 'Imprimer / Exporter en PDF…', exportImage: 'Exporter en image longue',
      copyMarkdown: 'Copier la source Markdown', copyHtml: 'Copier le HTML formaté', copyImage: 'Copier l\'image dans le presse-papiers',
      preferences: 'Préférences…', find: 'Rechercher', replace: 'Remplacer',
      h1: 'Titre 1 (H1)', h2: 'Titre 2 (H2)', h3: 'Titre 3 (H3)', h4: 'Titre 4 (H4)', h5: 'Titre 5 (H5)', h6: 'Titre 6 (H6)',
      paragraphText: 'Texte standard', bulletList: 'Liste à puces', numberedList: 'Liste numérotée', taskList: 'Liste de tâches',
      insertTable: 'Insérer un tableau', blockquote: 'Citation', codeBlock: 'Bloc de code', mathBlock: 'Bloc de formule',
      horizontalRule: 'Ligne de séparation', bold: 'Gras', italic: 'Italique', underline: 'Souligné', strikethrough: 'Barré',
      inlineCode: 'Code en ligne', inlineMath: 'Formule en ligne', insertLink: 'Insérer un lien',
      insertImage: 'Insérer une image locale…', insertWebImage: 'Insérer l\'URL d\'une image…',
      cleanAI: 'Nettoyer les traces IA', aiRewrite: 'Réécriture IA',
      editMode: 'Mode Édition', readingMode: 'Mode Lecture', sourceMode: 'Mode Source', splitView: 'Vue Côte à Côte',
      fileTreeSidebar: 'Arborescence des fichiers', docOutline: 'Plan du document', globalSearchMenu: 'Recherche globale',
      toggleSourceMode: 'Basculer Édition / Source', focusMode: 'Mode Concentration', typewriterMode: 'Mode Machine à écrire',
      fullscreen: 'Plein écran', limitEditorWidth: 'Limiter la largeur de l\'éditeur', customTheme: 'Personnalisé',
      aiAgent: 'Assistant IA Catstep', cjkProofread: 'Relecture CJK', cmdPalette: 'Palette de commandes', pomodoro: 'Catstep Focus'
    },
    common: {
      close: 'Fermer', cancel: 'Annuler', save: 'Enregistrer', back: 'Retour', done: 'Terminé', ok: 'OK', delete: 'Supprimer', edit: 'Modifier', copy: 'Copier'
    },
    panel: {
      expand: 'Développer le panneau', collapse: 'Réduire le panneau', close: 'Fermer le panneau'
    },
    find: {
      find: 'Rechercher', replace: 'Remplacer', findPlaceholder: 'Rechercher dans le document...', replacePlaceholder: 'Remplacer par...',
      next: 'Suivant', previous: 'Précédent', all: 'Tout sélectionner', matchCase: 'Respecter la casse', byWord: 'Mot entier',
      regexp: 'Expression régulière', replaceBtn: 'Remplacer', replaceAll: 'Tout remplacer', close: 'Fermer'
    },
    outline: {
      heading: 'Plan', close: 'Fermer le plan', empty: 'Aucun titre', expandSection: 'Développer la section',
      collapseSection: 'Réduire la section', jumpHint: 'Appuyez sur {key} pour naviguer', lineJumpHint: 'Entrée ↵ Aller · Échap Annuler',
      numberJumpHint: 'chiffre → naviguer · g+chiffres → ligne', letterJumpHint: 'lettre → naviguer · g+chiffres → ligne',
      filterPlaceholder: 'Filtrer les titres...', filterDepth: 'Niveau', filterDepthAll: 'Tous les niveaux (H1-H6)',
      filterDepthH2: 'H1-H2 uniquement', filterDepthH3: 'H1-H3 uniquement', collapseAll: 'Tout réduire', expandAll: 'Tout développer',
      scrollToActive: 'Localiser le titre actif', clearFilter: 'Effacer le filtre', noMatchingHeadings: 'Aucun titre correspondant',
      headingCount: '{count} titres', filteredCount: '{matched} / {total} titres'
    },
    commandPalette: {
      placeholder: 'Entrez une commande, un format ou un raccourci…', empty: 'Aucune commande correspondante',
      emptyHint: 'Essayez gras, tableau, titre ou affichage', navigate: 'Naviguer', execute: 'Exécuter', close: 'Fermer',
      totalCommands: '{n} commandes au total', matchingCommands: '{n} commandes trouvées'
    },
    editorCtx: {
      cut: 'Couper', copy: 'Copier', copyAs: 'Copier sous forme de', copyAsMarkdown: 'Copier en Markdown',
      copyAsHtml: 'Copier en code HTML', copyAsPlainText: 'Copier en texte brut', paste: 'Coller', pasteAsPlainText: 'Coller en texte brut',
      selectAll: 'Tout sélectionner', table: 'Tableau', insertRowAbove: 'Insérer une ligne au-dessus', insertRowBelow: 'Insérer une ligne en dessous',
      deleteRow: 'Supprimer la ligne', insertColLeft: 'Insérer une colonne à gauche', insertColRight: 'Insérer une colonne à droite', deleteCol: 'Supprimer la colonne',
      alignLeft: 'Aligner à gauche', alignCenter: 'Centrer', alignRight: 'Aligner à droite', openTableEditor: 'Ouvrir l\'éditeur de tableau', deleteTable: 'Supprimer le tableau',
      openLink: 'Ouvrir le lien', copyLinkAddress: 'Copier l\'adresse du lien', editLink: 'Modifier le lien', copyImagePath: 'Copier le chemin de l\'image',
      copyLatex: 'Copier la source LaTeX', editFormula: 'Modifier dans l\'éditeur de formule', copyCodeContent: 'Copier le code',
      aiAssistant: 'Assistant IA Catstep', aiPolish: 'Améliorer le style', aiExpand: 'Développer & Détailler', aiFix: 'Corriger la grammaire',
      aiDeAI: 'Humaniser le ton IA', transformCase: 'Changer la casse', uppercase: 'MAJUSCULES', lowercase: 'minuscules',
      titleCase: 'Casse De Titre', selectionStats: '{chars} caractères, {words} mots', insert: 'Insérer', insertTable: 'Tableau',
      insertCodeBlock: 'Bloc de code', insertMathBlock: 'Formule mathématique', insertQuote: 'Citation', insertLink: 'Lien', insertImage: 'Image...',
      insertImageUrl: 'Image depuis une URL...', insertHorizontalLine: 'Ligne de séparation', insertBulletList: 'Liste à puces', insertNumberedList: 'Liste numérotée',
      insertTaskList: 'Liste de tâches', format: 'Format', bold: 'Gras', italic: 'Italique', underline: 'Souligné', strikethrough: 'Barré',
      inlineCode: 'Code en ligne', inlineMath: 'Formule en ligne', highlight: 'Surligner', clearFormat: 'Effacer le formatage',
      paragraph: 'Paragraphe', heading1: 'Titre 1', heading2: 'Titre 2', heading3: 'Titre 3', heading4: 'Titre 4',
      heading5: 'Titre 5', heading6: 'Titre 6', normalParagraph: 'Paragraphe standard', promoteHeading: 'Promouvoir le niveau',
      demoteHeading: 'Rétrograder le niveau', select: 'Sélectionner', selectWord: 'Sélectionner le mot', selectLine: 'Sélectionner la ligne', selectParagraph: 'Sélectionner le paragraphe',
      findAndReplace: 'Rechercher et remplacer...'
    },
    unsaved: {
      title: 'Modifications non enregistrées',
      prompt: 'Voulez-vous enregistrer les modifications apportées à ce fichier ?',
      windowPrompt: '{count} fichiers ne sont pas enregistrés. Enregistrer les modifications ?',
      discardWarning: 'Si vous n\'enregistrez pas, les modifications apportées seront perdues.',
      modifiedBadge: 'Modifié',
      message: '{file} a été modifié. Enregistrer les modifications ?',
      save: 'Enregistrer',
      dontSave: 'Ne pas enregistrer',
      cancel: 'Annuler',
    }
  },
  ja: {
    menubar: {
      paragraph: '段落', format: 'フォーマット', themes: 'テーマ', tools: 'ツール',
      exportHtml: 'HTML をエクスポート', exportDocx: 'Word (DOCX) をエクスポート', exportPdf: 'PDF をエクスポート',
      exportPdfPrint: '印刷 / PDF エクスポート…', exportImage: '長画像としてエクスポート',
      copyMarkdown: 'Markdown ソースをコピー', copyHtml: 'フォーマット済み HTML をコピー', copyImage: '画像をクリップボードにコピー',
      preferences: '設定…', find: '検索', replace: '置換',
      h1: '見出し 1 (H1)', h2: '見出し 2 (H2)', h3: '見出し 3 (H3)', h4: '見出し 4 (H4)', h5: '見出し 5 (H5)', h6: '見出し 6 (H6)',
      paragraphText: '本文段落', bulletList: '箇条書きリスト', numberedList: '番号付きリスト', taskList: 'タスクリスト',
      insertTable: '表を挿入', blockquote: '引用ブロック', codeBlock: 'コードブロック', mathBlock: '数式ブロック',
      horizontalRule: '水平区切り線', bold: '太字', italic: '斜体', underline: '下線', strikethrough: '取り消し線',
      inlineCode: 'インラインコード', inlineMath: 'インライン数式', insertLink: 'リンクを挿入',
      insertImage: 'ローカル画像を挿入…', insertWebImage: '画像 URL を挿入…',
      cleanAI: 'AI 形式の痕跡を削除', aiRewrite: 'AI リライト',
      editMode: '編集モード', readingMode: '閲覧モード', sourceMode: 'ソースモード', splitView: '左右分割表示',
      fileTreeSidebar: 'ファイルツリー', docOutline: '文書アウトライン', globalSearchMenu: '全体検索',
      toggleSourceMode: '編集 / ソースモード切替', focusMode: '集中モード', typewriterMode: 'タイプライターモード',
      fullscreen: '全画面表示', limitEditorWidth: 'エディタ幅を制限', customTheme: 'カスタム',
      aiAgent: 'Catstep AI アシスタント', cjkProofread: 'CJK 文章校正', cmdPalette: 'コマンドパレット', pomodoro: 'Catstep 集中'
    },
    common: {
      close: '閉じる', cancel: 'キャンセル', save: '保存', back: '戻る', done: '完了', ok: 'OK', delete: '削除', edit: '編集', copy: 'コピー'
    },
    panel: {
      expand: 'パネルを展開', collapse: 'パネルを折りたたむ', close: 'パネルを閉じる'
    },
    find: {
      find: '検索', replace: '置換', findPlaceholder: 'ドキュメント内を検索...', replacePlaceholder: '置換後の文字列...',
      next: '次へ', previous: '前へ', all: 'すべて選択', matchCase: '大文字/小文字を区別', byWord: '単語単位',
      regexp: '正規表現', replaceBtn: '置換', replaceAll: 'すべて置換', close: '閉じる'
    },
    outline: {
      heading: 'アウトライン', close: 'アウトラインを閉じる', empty: '見出しがありません', expandSection: 'セクションを展開',
      collapseSection: 'セクションを折りたたむ', jumpHint: '{key} でジャンプ', lineJumpHint: 'Enter ↵ 移動 · Esc キャンセル',
      numberJumpHint: '数字 → ジャンプ · g+数字 → 行', letterJumpHint: '文字 → ジャンプ · g+数字 → 行',
      filterPlaceholder: '見出しを絞り込み...', filterDepth: '見出しの深さ', filterDepthAll: 'すべてのレベル (H1-H6)',
      filterDepthH2: 'H1-H2 のみ', filterDepthH3: 'H1-H3 のみ', collapseAll: 'すべて折りたたむ', expandAll: 'すべて展開',
      scrollToActive: '現在の見出しへスクロール', clearFilter: 'フィルター解除', noMatchingHeadings: '一致する見出しがありません',
      headingCount: '{count} 個の見出し', filteredCount: '{matched} / {total} 個の見出し'
    },
    commandPalette: {
      placeholder: 'コマンド、書式、ショートカットを入力…', empty: '一致するコマンドがありません',
      emptyHint: '太字、表、見出しなどで検索', navigate: '移動', execute: '実行', close: '閉じる',
      totalCommands: '全 {n} 件のコマンド', matchingCommands: '{n} 件の一致するコマンド'
    },
    editorCtx: {
      cut: '切り取り', copy: 'コピー', copyAs: '形式を指定してコピー', copyAsMarkdown: 'Markdown としてコピー',
      copyAsHtml: 'HTML コードとしてコピー', copyAsPlainText: 'プレーンテキストとしてコピー',
      paste: '貼り付け', pasteAsPlainText: 'プレーンテキストとして貼り付け', selectAll: 'すべて選択',
      table: '表', insertRowAbove: '上に行を挿入', insertRowBelow: '下に行を挿入', deleteRow: '行を削除',
      insertColLeft: '左に列を挿入', insertColRight: '右に列を挿入', deleteCol: '列を削除',
      alignLeft: '左揃え', alignCenter: '中央揃え', alignRight: '右揃え', openTableEditor: '表エディタを開く',
      deleteTable: '表を削除', openLink: 'リンクを開く', copyLinkAddress: 'リンクアドレスをコピー', editLink: 'リンクを編集',
      copyImagePath: '画像パスをコピー', copyLatex: 'LaTeX ソースをコピー', editFormula: '数式エディタで編集',
      copyCodeContent: 'コード内容をコピー', aiAssistant: 'Catstep AI アシスタント', aiPolish: '文章を推敲',
      aiExpand: '詳細を展開', aiFix: '誤字脱字を修正', aiDeAI: 'AI 調を緩和', transformCase: '大文字/小文字変換',
      uppercase: '大文字 (UPPERCASE)', lowercase: '小文字 (lowercase)', titleCase: 'タイトルケース (Title Case)',
      selectionStats: '{chars} 文字、{words} 語', insert: '挿入', insertTable: '表', insertCodeBlock: 'コードブロック',
      insertMathBlock: '数式ブロック', insertQuote: '引用', insertLink: 'リンク', insertImage: '画像...',
      insertImageUrl: 'URL から画像を挿入...', insertHorizontalLine: '水平区切り線', insertBulletList: '箇条書きリスト',
      insertNumberedList: '番号付きリスト', insertTaskList: 'タスクリスト', format: '書式', bold: '太字',
      italic: '斜体', underline: '下線', strikethrough: '取り消し線', inlineCode: 'インラインコード',
      inlineMath: 'インライン数式', highlight: 'ハイライト', clearFormat: '書式をクリア', paragraph: '段落',
      heading1: '見出し 1', heading2: '見出し 2', heading3: '見出し 3', heading4: '見出し 4', heading5: '見出し 5',
      heading6: '見出し 6', normalParagraph: '標準段落', promoteHeading: '見出しレベルを上げる',
      demoteHeading: '見出しレベルを下げる', select: '選択', selectWord: '単語を選択', selectLine: '行を選択',
      selectParagraph: '段落を選択',
      findAndReplace: '検索と置換...'
    },
    unsaved: {
      title: '未保存の変更',
      prompt: 'このファイルへの変更を保存しますか？',
      windowPrompt: '{count} 件の未保存ファイルがあります。変更を保存しますか？',
      discardWarning: '保存しない場合、前回の保存以降の変更内容は失われます。',
      modifiedBadge: '変更あり',
      message: '{file} は変更されています。保存しますか？',
      save: '保存',
      dontSave: '保存しない',
      cancel: 'キャンセル',
    }
  },
  es: {
    menubar: {
      paragraph: 'Párrafo', format: 'Formato', themes: 'Temas', tools: 'Herramientas',
      exportHtml: 'Exportar HTML', exportDocx: 'Exportar Word (DOCX)', exportPdf: 'Exportar PDF',
      exportPdfPrint: 'Imprimir / Exportar PDF…', exportImage: 'Exportar imagen larga',
      copyMarkdown: 'Copiar código Markdown', copyHtml: 'Copiar HTML formateado', copyImage: 'Copiar imagen al portapapeles',
      preferences: 'Preferencias…', find: 'Buscar', replace: 'Reemplazar',
      h1: 'Encabezado 1 (H1)', h2: 'Encabezado 2 (H2)', h3: 'Encabezado 3 (H3)', h4: 'Encabezado 4 (H4)', h5: 'Encabezado 5 (H5)', h6: 'Encabezado 6 (H6)',
      paragraphText: 'Párrafo de texto', bulletList: 'Lista con viñetas', numberedList: 'Lista numerada', taskList: 'Lista de tareas',
      insertTable: 'Insertar tabla', blockquote: 'Cita', codeBlock: 'Bloque de código', mathBlock: 'Fórmula matemática',
      horizontalRule: 'Línea divisoria', bold: 'Negrita', italic: 'Cursiva', underline: 'Subrayado', strikethrough: 'Tachado',
      inlineCode: 'Código en línea', inlineMath: 'Fórmula en línea', insertLink: 'Insertar enlace',
      insertImage: 'Insertar imagen local…', insertWebImage: 'Insertar imagen desde URL…',
      cleanAI: 'Limpiar huellas de IA', aiRewrite: 'Reescritura IA',
      editMode: 'Modo Edición', readingMode: 'Modo Lectura', sourceMode: 'Modo Código', splitView: 'Vista Dividida',
      fileTreeSidebar: 'Árbol de archivos', docOutline: 'Esquema del documento', globalSearchMenu: 'Búsqueda global',
      toggleSourceMode: 'Alternar Edición / Código', focusMode: 'Modo Enfoque', typewriterMode: 'Modo Máquina de escribir',
      fullscreen: 'Pantalla completa', limitEditorWidth: 'Limitar ancho del editor', customTheme: 'Personalizado',
      aiAgent: 'Asistente IA Catstep', cjkProofread: 'Corrección CJK', cmdPalette: 'Paleta de comandos', pomodoro: 'Catstep Enfoque'
    },
    common: {
      close: 'Cerrar', cancel: 'Cancelar', save: 'Guardar', back: 'Volver', done: 'Listo', ok: 'Aceptar', delete: 'Eliminar', edit: 'Editar', copy: 'Copiar'
    },
    panel: {
      expand: 'Expandir panel', collapse: 'Contraer panel', close: 'Cerrar panel'
    },
    find: {
      find: 'Buscar', replace: 'Reemplazar', findPlaceholder: 'Buscar en el documento...', replacePlaceholder: 'Reemplazar con...',
      next: 'Siguiente', previous: 'Anterior', all: 'Seleccionar todo', matchCase: 'Coincidir mayúsculas/minúsculas', byWord: 'Palabra completa',
      regexp: 'Expresión regular', replaceBtn: 'Reemplazar', replaceAll: 'Reemplazar todo', close: 'Cerrar'
    },
    outline: {
      heading: 'Esquema', close: 'Cerrar esquema', empty: 'No hay encabezados', expandSection: 'Expandir sección',
      collapseSection: 'Contraer sección', jumpHint: 'Presione {key} para saltar', lineJumpHint: 'Enter ↵ Ir · Esc Cancelar',
      numberJumpHint: 'número → saltar · g+dígitos → línea', letterJumpHint: 'letra → saltar · g+dígitos → línea',
      filterPlaceholder: 'Filtrar encabezados...', filterDepth: 'Profundidad', filterDepthAll: 'Todos los niveles (H1-H6)',
      filterDepthH2: 'Solo H1-H2', filterDepthH3: 'Solo H1-H3', collapseAll: 'Contraer todo', expandAll: 'Expandir todo',
      scrollToActive: 'Ubicar encabezado actual', clearFilter: 'Borrar filtro', noMatchingHeadings: 'No hay encabezados coincidentes',
      headingCount: '{count} encabezados', filteredCount: '{matched} / {total} encabezados'
    },
    commandPalette: {
      placeholder: 'Escriba un comando, formato o atajo…', empty: 'No hay comandos coincidentes',
      emptyHint: 'Intente buscar negrita, tabla, encabezado o vista', navigate: 'Navegar', execute: 'Ejecutar', close: 'Cerrar',
      totalCommands: '{n} comandos en total', matchingCommands: '{n} comandos encontrados'
    },
    editorCtx: {
      cut: 'Cortar', copy: 'Copiar', copyAs: 'Copiar como', copyAsMarkdown: 'Copiar como Markdown',
      copyAsHtml: 'Copiar como código HTML', copyAsPlainText: 'Copiar como texto plano', paste: 'Pegar', pasteAsPlainText: 'Pegar como texto plano',
      selectAll: 'Seleccionar todo', table: 'Tabla', insertRowAbove: 'Insertar fila arriba', insertRowBelow: 'Insertar fila abajo',
      deleteRow: 'Eliminar fila', insertColLeft: 'Insertar columna a la izquierda', insertColRight: 'Insertar columna a la derecha', deleteCol: 'Eliminar columna',
      alignLeft: 'Alinear a la izquierda', alignCenter: 'Centrar', alignRight: 'Alinear a la derecha', openTableEditor: 'Abrir editor de tablas', deleteTable: 'Eliminar tabla',
      openLink: 'Abrir enlace', copyLinkAddress: 'Copiar dirección del enlace', editLink: 'Editar enlace', copyImagePath: 'Copiar ruta de la imagen',
      copyLatex: 'Copiar código LaTeX', editFormula: 'Editar en editor de fórmulas', copyCodeContent: 'Copier contenido del código',
      aiAssistant: 'Asistente IA Catstep', aiPolish: 'Mejorar estilo', aiExpand: 'Expandir contenido', aiFix: 'Corregir gramática',
      aiDeAI: 'Humanizar tono de IA', transformCase: 'Cambiar mayúsculas/minúsculas', uppercase: 'MAYÚSCULAS', lowercase: 'minúsculas',
      titleCase: 'Tipo Título', selectionStats: '{chars} caracteres, {words} palabras', insert: 'Insertar', insertTable: 'Tabla',
      insertCodeBlock: 'Bloque de código', insertMathBlock: 'Fórmula matemática', insertQuote: 'Cita', insertLink: 'Enlace', insertImage: 'Imagen...',
      insertImageUrl: 'Imagen desde URL...', insertHorizontalLine: 'Línea divisoria', insertBulletList: 'Lista con viñetas', insertNumberedList: 'Lista numerada',
      insertTaskList: 'Lista de tareas', format: 'Formato', bold: 'Negrita', italic: 'Cursiva', underline: 'Subrayado', strikethrough: 'Tachado',
      inlineCode: 'Código en línea', inlineMath: 'Fórmula en línea', highlight: 'Resaltar', clearFormat: 'Borrar formato',
      paragraph: 'Párrafo', heading1: 'Encabezado 1', heading2: 'Encabezado 2', heading3: 'Encabezado 3', heading4: 'Encabezado 4',
      heading5: 'Encabezado 5', heading6: 'Encabezado 6', normalParagraph: 'Párrafo normal', promoteHeading: 'Aumentar nivel de encabezado',
      demoteHeading: 'Reducir nivel de encabezado', select: 'Seleccionar', selectWord: 'Seleccionar palabra', selectLine: 'Seleccionar línea', selectParagraph: 'Seleccionar párrafo',
      findAndReplace: 'Buscar y reemplazar...'
    },
    unsaved: {
      title: 'Cambios no guardados',
      prompt: '¿Desea guardar los cambios en este archivo?',
      windowPrompt: 'Hay {count} archivos sin guardar. ¿Guardar cambios?',
      discardWarning: 'Si no guarda, se perderán los cambios realizados desde el último guardado.',
      modifiedBadge: 'Modificado',
      message: '{file} ha sido modificado. ¿Guardar cambios?',
      save: 'Guardar',
      dontSave: 'No guardar',
      cancel: 'Cancelar',
    }
  }
};

// Deep merge helper that fills in any key missing in target from source or translations
function deepFill(target, source, customOverrides) {
  const res = { ...target };
  for (const [k, v] of Object.entries(source)) {
    if (!(k in res) || res[k] === undefined || res[k] === null) {
      if (customOverrides && k in customOverrides) {
        res[k] = customOverrides[k];
      } else if (typeof v === 'object' && !Array.isArray(v)) {
        res[k] = deepFill({}, v, customOverrides ? customOverrides[k] : undefined);
      } else {
        res[k] = v; // clean fallback to base
      }
    } else if (typeof v === 'object' && !Array.isArray(v) && typeof res[k] === 'object') {
      res[k] = deepFill(res[k], v, customOverrides ? customOverrides[k] : undefined);
    }
  }
  return res;
}

// Order keys matching source object order
function orderKeys(target, template) {
  const res = {};
  for (const k of Object.keys(template)) {
    if (k in target) {
      if (typeof template[k] === 'object' && !Array.isArray(template[k]) && typeof target[k] === 'object') {
        res[k] = orderKeys(target[k], template[k]);
      } else {
        res[k] = target[k];
      }
    }
  }
  for (const k of Object.keys(target)) {
    if (!(k in res)) {
      res[k] = target[k];
    }
  }
  return res;
}

async function alignAll() {
  console.log('Loading base en and zh dictionaries...');
  const modEn = await import(pathToFileURL(path.join(I18N_DIR, 'en.ts')).href);
  const baseEn = modEn.en;

  const targetLangs = ['ja', 'ko', 'de', 'fr', 'es', 'pt', 'it', 'pl', 'nl', 'tr', 'sv', 'uk'];

  for (const lang of targetLangs) {
    const filePath = path.join(I18N_DIR, `${lang}.ts`);
    const mod = await import(pathToFileURL(filePath).href);
    const existing = mod[lang];
    const overrides = TRANSLATIONS[lang] || {};

    const merged = deepFill(existing, baseEn, overrides);
    const ordered = orderKeys(merged, baseEn);

    const code = `import type { I18n } from './en';\n\nexport const ${lang}: I18n = ${JSON.stringify(ordered, null, 2)};\n`;
    fs.writeFileSync(filePath, code, 'utf-8');
    console.log(`Aligned locale [${lang}] -> written to ${filePath}`);
  }

  console.log('✨ All 12 target locales successfully aligned to 100% key parity!');
}

alignAll().catch(err => {
  console.error(err);
  process.exit(1);
});
