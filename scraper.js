const { connect } = require('puppeteer-real-browser');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function iniciarScraper() {
    console.log('--- Operação Dismatal: Invasão Direta via /login/modal ---');

    const { browser, page } = await connect({
        args: ["--start-maximized", "--no-sandbox"],
        headless: false,
        customConfig: {},
        skipTargetCheck: true
    });

    try {
        await page.setUserAgent(process.env.USER_AGENT_REAL);
        await page.setViewport({ width: 1366, height: 768 });

        // 🚩 O PULO DO GATO: Vamos direto para a URL que você descobriu
        console.log('Passo 1: Acessando a URL do modal diretamente...');
        await page.goto('https://b2b.dismatal.com.br/login/modal', { 
            waitUntil: 'networkidle2', 
            timeout: 60000 
        });

        await new Promise(res => setTimeout(res, 5000));
        await page.screenshot({ path: '01-pagina-login-direta.png' });

        console.log('Passo 2: Preenchendo credenciais...');
        // Espera pelos campos que agora DEVEM estar na tela sem pop-up
        await page.waitForSelector('input[type="password"]', { timeout: 15000 });

        // Preenchimento via injeção de valor (mais garantido)
        await page.evaluate((u, p) => {
            const inputs = [...document.querySelectorAll('input')];
            const userField = inputs.find(i => i.type === 'text' || i.type === 'email' || i.name.includes('login'));
            const passField = inputs.find(i => i.type === 'password');
            
            if (userField && passField) {
                userField.value = u;
                passField.value = p;
                userField.dispatchEvent(new Event('input', { bubbles: true }));
                passField.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }, process.env.DISMATAL_USER, process.env.DISMATAL_PASS);

        await page.screenshot({ path: '02-login-preenchido.png' });
        
        // Clica no botão de entrar (geralmente o único submit da página)
        await page.keyboard.press('Enter');
        console.log('Login enviado. Aguardando processamento...');
        await new Promise(res => setTimeout(res, 15000));

        // 🚩 Passo crucial: Navegar para o produto após o login
        console.log('Passo 3: Indo para o produto...');
        await page.goto('https://b2b.dismatal.com.br/produtos/1135574', { waitUntil: 'networkidle2' });
        await new Promise(res => setTimeout(res, 10000));
        await page.screenshot({ path: '03-produto-final.png' });

        const data = await page.evaluate(() => {
            const body = document.body.innerText;
            const precoMatch = body.match(/R\$\s?([0-9.,]+)/);
            return {
                preco: precoMatch ? precoMatch[0] : null,
                logado: !body.includes('Olá, faça seu login')
            };
        });

        if (data.preco) {
            const valor = parseFloat(data.preco.replace(/[^\d,]/g, '').replace(',', '.'));
            console.log(`✅ SUCESSO DISMATAL: R$ ${valor}`);
            
            await supabase.from('precos_dismatal').insert({
                sku: '1135574',
                nome_produto: 'Disjuntor Dismatal',
                preco: valor,
                url: 'https://b2b.dismatal.com.br/produtos/1135574'
            });
            console.log('Gravado no Supabase.');
        } else {
            console.log(`❌ Falha: Preço não encontrado. Logado? ${data.logado}`);
            process.exit(1);
        }

    } catch (err) {
        console.error('ERRO:', err.message);
        await page.screenshot({ path: 'erro-direto.png', fullPage: true });
        process.exit(1);
    } finally {
        await browser.close();
    }
}

iniciarScraper();
