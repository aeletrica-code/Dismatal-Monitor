const { connect } = require('puppeteer-real-browser');
const { createClient } = require('@supabase/supabase-js');

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
    console.error("❌ ERRO: Chaves do Supabase não configuradas.");
    process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function iniciarScraper() {
    console.log('--- Operação Dismatal: Modo Diagnóstico ---');

    const { browser, page } = await connect({
        args: ["--start-maximized", "--no-sandbox"],
        headless: false,
        customConfig: {},
        skipTargetCheck: true
    });

    try {
        await page.setUserAgent(process.env.USER_AGENT_REAL);
        await page.setViewport({ width: 1366, height: 768 });

        console.log('Passo 1: Acessando URL de login...');
        // Tentamos ir direto para o login
        const response = await page.goto('https://b2b.dismatal.com.br/login', { 
            waitUntil: 'networkidle2',
            timeout: 60000 
        });

        console.log(`Status da página: ${response.status()}`);
        
        // Aguarda um pouco para garantir que JS carregou
        await new Promise(res => setTimeout(res, 10000));
        await page.screenshot({ path: '01-tela-inicial.png' });

        console.log('Passo 2: Procurando campos de login...');
        
        // Tentativa de achar QUALQUER input de texto e senha se o seletor falhar
        try {
            await page.waitForSelector('input[type="text"], input[type="email"], input[name*="login"]', { timeout: 15000 });
        } catch (e) {
            console.log('⚠️ Campos específicos não achados. Verifique 01-tela-inicial.png');
            await page.screenshot({ path: 'erro-seletores.png', fullPage: true });
            throw new Error("Não foi possível localizar os campos de entrada.");
        }

        // Se chegou aqui, os campos existem. Vamos preencher:
        const inputs = await page.$$('input');
        for (let input of inputs) {
            const type = await (await input.getProperty('type')).jsonValue();
            const name = await (await input.getProperty('name')).jsonValue();
            
            if (type === 'text' || type === 'email' || name.includes('login')) {
                await input.type(process.env.DISMATAL_USER, { delay: 100 });
            }
            if (type === 'password') {
                await input.type(process.env.DISMATAL_PASS, { delay: 100 });
            }
        }

        await page.screenshot({ path: '02-dados-preenchidos.png' });
        
        // Tenta clicar no botão principal
        await page.keyboard.press('Enter'); 
        console.log('Login enviado via Enter...');

        await new Promise(res => setTimeout(res, 15000));
        await page.screenshot({ path: '03-apos-login.png' });

        // Navegação para o produto
        console.log('Passo 3: Acessando produto...');
        await page.goto('https://b2b.dismatal.com.br/produtos/1135574', { waitUntil: 'networkidle2' });
        await new Promise(res => setTimeout(res, 10000));
        await page.screenshot({ path: '04-produto-final.png' });

        // Extração Simples
        const preco = await page.evaluate(() => {
            const matches = document.body.innerText.match(/R\$\s?([0-9.,]+)/);
            return matches ? matches[0] : null;
        });

        if (preco) {
            const valor = parseFloat(preco.replace(/[^\d,]/g, '').replace(',', '.'));
            console.log(`✅ SUCESSO DISMATAL: R$ ${valor}`);
            await supabase.from('precos_dismatal').insert({
                sku: '1135574',
                nome_produto: 'Produto Dismatal',
                preco: valor,
                url: 'https://b2b.dismatal.com.br/produtos/1135574'
            });
        } else {
            console.log('❌ Preço não encontrado no HTML final.');
        }

    } catch (err) {
        console.error('FALHA GERAL:', err.message);
        await page.screenshot({ path: 'ERRO-CRITICO.png', fullPage: true });
        process.exit(1);
    } finally {
        await browser.close();
    }
}

iniciarScraper();
