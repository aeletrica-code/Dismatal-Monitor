const { connect } = require('puppeteer-real-browser');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function iniciarScraper() {
    console.log('--- Operação Dismatal: Início de Coleta ---');

    const { browser, page } = await connect({
        args: ["--start-maximized", "--no-sandbox"],
        headless: false,
        customConfig: {},
        skipTargetCheck: true
    });

    try {
        await page.setUserAgent(process.env.USER_AGENT_REAL);
        await page.setViewport({ width: 1366, height: 768 });

        // 1. Login na Dismatal
        console.log('Passo 1: Autenticando no portal B2B...');
        await page.goto('https://b2b.dismatal.com.br/login', { waitUntil: 'networkidle2' });
        
        await page.waitForSelector('input[name="login"], #login');
        await page.type('input[name="login"], #login', process.env.DISMATAL_USER, { delay: 100 });
        await page.type('input[type="password"]', process.env.DISMATAL_PASS, { delay: 100 });
        
        await page.click('button[type="submit"], .btn-login');
        await new Promise(res => setTimeout(res, 12000)); // Espera o dashboard carregar

        // 2. Acesso ao Produto
        const urlProduto = 'https://b2b.dismatal.com.br/produtos/1135574';
        console.log(`Passo 2: Acessando SKU 1135574...`);
        await page.goto(urlProduto, { waitUntil: 'networkidle2' });
        await new Promise(res => setTimeout(res, 8000));

        // 3. Extração Inteligente
        const resultado = await page.evaluate(() => {
            const body = document.body.innerText;
            const logado = !body.includes('Entrar') && !body.includes('Cadastrar');
            
            // Regex focado no padrão R$ da Dismatal
            const regex = /R\$\s?([0-9.,]+)/g;
            const matches = [...body.matchAll(regex)];
            const precos = matches.map(m => m[1]).filter(p => p.includes(','));

            return {
                isLogado: logado,
                precoTexto: precos.length > 0 ? precos[0] : null,
                nome: document.title.split('|')[0].trim()
            };
        });

        if (resultado.precoTexto && resultado.isLogado) {
            const precoFinal = parseFloat(resultado.precoTexto.replace(/\./g, '').replace(',', '.'));
            console.log(`✅ SUCESSO! Produto: ${resultado.nome} | Preço: R$ ${precoFinal}`);

            // Inserção na nova tabela (precos_dismatal)
            const { error } = await supabase.from('precos_dismatal').insert({
                sku: '1135574',
                nome_produto: resultado.nome,
                preco: precoFinal,
                url: urlProduto
            });

            if (error) throw error;
            console.log('Dados registrados no Supabase com sucesso.');
        } else {
            console.log('❌ Falha na extração. Tirando print para análise...');
            await page.screenshot({ path: 'falha-dismatal.png' });
            process.exit(1);
        }

    } catch (err) {
        console.error('ERRO CRÍTICO:', err.message);
        process.exit(1);
    } finally {
        await browser.close();
    }
}

iniciarScraper();
