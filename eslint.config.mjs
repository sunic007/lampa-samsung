import es from 'eslint-plugin-es-x';
import compat from 'eslint-plugin-compat';

// TV modules only; app.js and vendored libraries have separate build contracts.
export default [{
    files: ['src/update.js', 'src/loader.js', 'src/bs*.js', 'src/skazauto.js', 'src/playerguard.js', 'src/polyfills.js'],
    languageOptions: { ecmaVersion: 5, sourceType: 'script' },
    plugins: { 'es-x': es, compat },
    // Only compatibility rules: no-undef and other core/style rules are not enabled.
    rules: { ...es.configs['flat/restrict-to-es5'].rules, 'compat/compat': 'error' },
    settings: { browsers: ['chrome >= 47'] }
}];
