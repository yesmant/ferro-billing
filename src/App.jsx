import React, { useState, useEffect } from 'react';
import {
    Plus,
    Trash2,
    FileText,
    Download,
    Send,
    History,
    Package,
    Users,
    Calculator,
    ChevronRight,
    Printer,
    CheckCircle,
    AlertCircle,
    LogOut,
    Calendar,
    LineChart,
    DollarSign,
    ExternalLink
} from 'lucide-react';
import { supabase } from './lib/supabase';
import { format, differenceInDays, addDays } from 'date-fns';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import confetti from 'canvas-confetti';

function App() {
    const [session, setSession] = useState(null);
    const [activeTab, setActiveTab] = useState('new-rental');
    const [inventory, setInventory] = useState([]);
    const [activeRentals, setActiveRentals] = useState([]);
    const [selectedItems, setSelectedItems] = useState([]);
    const [clientInfo, setClientInfo] = useState({ name: '', nit: '', phone: '', address: '', workSite: '' });
    const [estimatedDays, setEstimatedDays] = useState(1);
    const [transportCost, setTransportCost] = useState(0);
    const [customDeposit, setCustomDeposit] = useState(null);
    const [liquidatingRental, setLiquidatingRental] = useState(null);
    const [overrideDays, setOverrideDays] = useState(null);
    const [clientsData, setClientsData] = useState([]);
    const [accountingData, setAccountingData] = useState([]);
    const [accountingFilter, setAccountingFilter] = useState('all');
    const [customDates, setCustomDates] = useState({ start: '', end: '' });
    const [finalAdjustment, setFinalAdjustment] = useState(0);
    const [receivedAmount, setReceivedAmount] = useState(0);
    const [clientViewMode, setClientViewMode] = useState('cards');
    const [editingItem, setEditingItem] = useState(null);
    const [inventoryForm, setInventoryForm] = useState({ name: '', ref: '', unit_price: 0, min_days: 0 });
    const [isInventoryModalOpen, setIsInventoryModalOpen] = useState(false);
    const [returnQtys, setReturnQtys] = useState({});
    const [loading, setLoading] = useState(false);

    // Auth states
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');

    useEffect(() => {
        supabase.auth.getSession().then(({ data: { session } }) => {
            setSession(session);
        });

        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            setSession(session);
        });

        return () => subscription.unsubscribe();
    }, []);

    useEffect(() => {
        if (session) {
            fetchInventory();
            fetchActiveRentals();
            if (activeTab === 'clients') fetchClientsAnalysis();
            if (activeTab === 'accounting') fetchAccounting();
        }
    }, [session, activeTab]);

    const fetchClientsAnalysis = async () => {
        const { data: clients } = await supabase.from('clients').select('*, rentals(*, invoices(*))');
        if (clients) {
            const analyzed = clients.map(c => {
                const totalGenerated = c.rentals.reduce((acc, r) => {
                    const invoiceSum = r.invoices.reduce((sum, inv) => sum + (inv.total_amount || 0), 0);
                    return acc + invoiceSum;
                }, 0);
                const activeProjects = c.rentals.filter(r => r.status === 'PENDING').length;
                return { ...c, totalGenerated, activeProjects };
            }).sort((a, b) => b.totalGenerated - a.totalGenerated);
            setClientsData(analyzed);
        }
    };

    const fetchAccounting = async () => {
        let query = supabase
            .from('invoices')
            .select('*, rentals(*, clients(*))')
            .order('created_at', { ascending: false });

        const now = new Date();
        if (accountingFilter === 'today') {
            query = query.gte('created_at', new Date(now.setHours(0, 0, 0, 0)).toISOString());
        } else if (accountingFilter === 'week') {
            const weekStart = new Date(now.setDate(now.getDate() - now.getDay()));
            query = query.gte('created_at', weekStart.toISOString());
        } else if (accountingFilter === 'month') {
            const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
            query = query.gte('created_at', monthStart.toISOString());
        } else if (accountingFilter === 'custom' && customDates.start && customDates.end) {
            query = query.gte('created_at', new Date(customDates.start).toISOString())
                .lte('created_at', new Date(customDates.end).toISOString());
        }

        const { data: invoices } = await query;
        if (invoices) setAccountingData(invoices);
    };

    // Auto-load client when NIT changes
    useEffect(() => {
        const timer = setTimeout(async () => {
            if (clientInfo.nit.length >= 7) {
                const { data, error } = await supabase
                    .from('clients')
                    .select('*')
                    .eq('nit_cc', clientInfo.nit)
                    .maybeSingle();

                if (data) {
                    setClientInfo(prev => ({
                        ...prev,
                        name: data.name,
                        phone: data.phone || '',
                        address: data.address || ''
                        // workSite remains what the user is typing
                    }));
                }
            }
        }, 500);
        return () => clearTimeout(timer);
    }, [clientInfo.nit]);

    const fetchInventory = async () => {
        const { data } = await supabase.from('inventory').select('*').order('name', { ascending: true });
        if (data) setInventory(data);
    };

    const fetchActiveRentals = async () => {
        const { data } = await supabase
            .from('rentals')
            .select('*, clients(*), rental_items(*, inventory(*))')
            .eq('status', 'PENDING')
            .order('created_at', { ascending: false });
        if (data) setActiveRentals(data);
    };

    const handleSaveInventory = async () => {
        setLoading(true);
        try {
            if (editingItem) {
                const { error } = await supabase
                    .from('inventory')
                    .update(inventoryForm)
                    .eq('id', editingItem.id);
                if (error) throw error;
            } else {
                const { error } = await supabase
                    .from('inventory')
                    .insert([inventoryForm]);
                if (error) throw error;
            }
            await fetchInventory();
            setIsInventoryModalOpen(false);
            setEditingItem(null);
            setInventoryForm({ name: '', ref: '', unit_price: 0, min_days: 0 });
            alert("Inventario actualizado correctamente.");
        } catch (error) {
            alert("Error al guardar: " + error.message);
        } finally {
            setLoading(false);
        }
    };

    const handleLogin = async (e) => {
        e.preventDefault();
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) alert(error.message);
    };

    const addItem = (item) => {
        const existing = selectedItems.find(i => i.id === item.id);
        if (existing) {
            setSelectedItems(selectedItems.map(i => i.id === item.id ? { ...i, quantity: i.quantity + 1 } : i));
        } else {
            setSelectedItems([...selectedItems, { ...item, quantity: 1, editablePrice: item.unit_price }]);
        }
    };

    const removeItem = (id) => {
        setSelectedItems(selectedItems.filter(i => i.id !== id));
    };

    const updateQuantity = (id, q) => {
        setSelectedItems(selectedItems.map(i => i.id === id ? { ...i, quantity: Math.max(1, q) } : i));
    };

    const calculateTotals = () => {
        const subtotalPerDay = selectedItems.reduce((acc, item) => acc + (item.editablePrice * item.quantity), 0);
        const subtotalTotal = subtotalPerDay * estimatedDays;
        const suggestedDeposit = selectedItems.reduce((acc, item) => {
            if (item.ref === 'E-1') return acc + (50000 * item.quantity);
            return acc + (item.deposit_per_unit * item.quantity);
        }, 0);

        const deposit = customDeposit !== null ? customDeposit : suggestedDeposit;

        return { subtotalPerDay, subtotalTotal, suggestedDeposit, deposit, total: subtotalTotal + parseFloat(transportCost || 0) };
    };

    const totals = calculateTotals();

    const handleSettleInvoice = async (invoiceId, currentBalance, currentReceived) => {
        const amount = prompt(`Monto a pagar (Saldo pendiente: $${currentBalance.toLocaleString()}):`, currentBalance);
        if (amount === null) return;
        const paid = parseFloat(amount);
        if (isNaN(paid) || paid <= 0) {
            alert("Por favor ingrese un monto válido.");
            return;
        }

        setLoading(true);
        try {
            const newBalance = currentBalance - paid;
            const newReceived = (currentReceived || 0) + paid;

            const { error } = await supabase
                .from('invoices')
                .update({
                    final_balance: newBalance,
                    received_amount: newReceived
                })
                .eq('id', invoiceId);

            if (error) throw error;

            await fetchAccounting();
            alert("Cobro registrado con éxito.");
        } catch (error) {
            alert("Error al registrar pago: " + error.message);
        } finally {
            setLoading(false);
        }
    };

    const handleGenerateEstimate = async () => {
        if (!clientInfo.name || !clientInfo.nit) return alert("Faltan datos del cliente (Nombre y NIT/CC son obligatorios)");
        if (selectedItems.length === 0) return alert("Debes seleccionar al menos un equipo");

        setLoading(true);
        try {
            // 1. Buscar o Crear Cliente
            let { data: client, error: clientFetchError } = await supabase
                .from('clients')
                .select('id')
                .eq('nit_cc', clientInfo.nit)
                .maybeSingle(); // maybeSingle() no arroja error si no lo encuentra

            if (clientFetchError) throw clientFetchError;

            if (!client) {
                const { data: newClient, error: createError } = await supabase
                    .from('clients')
                    .insert([{
                        nit_cc: clientInfo.nit,
                        name: clientInfo.name,
                        phone: clientInfo.phone,
                        address: clientInfo.address,
                        work_site: clientInfo.workSite
                    }])
                    .select()
                    .single();

                if (createError) throw createError;
                client = newClient;
            }

            // 2. Crear el Alquiler (Rental)
            const { data: rental, error: rentalError } = await supabase
                .from('rentals')
                .insert([{
                    client_id: client.id,
                    total_deposit: totals.deposit,
                    transport_cost: parseFloat(transportCost) || 0,
                    status: 'PENDING',
                    start_date: new Date().toISOString(),
                    end_date_estimated: addDays(new Date(), estimatedDays).toISOString()
                }])
                .select()
                .single();

            if (rentalError) throw rentalError;

            // 3. Crear los Items del Alquiler
            const itemsToInsert = selectedItems.map(item => ({
                rental_id: rental.id,
                inventory_id: item.id,
                quantity: item.quantity,
                unit_price_at_time: item.editablePrice,
                min_days_at_time: item.min_days
            }));

            const { error: itemsError } = await supabase.from('rental_items').insert(itemsToInsert);
            if (itemsError) throw itemsError;

            // 4. Generar PDF y Limpiar
            generateEstimatePDF(rental.id);
            confetti();
            setSelectedItems([]);
            setClientInfo({ name: '', nit: '', phone: '', address: '', workSite: '' });
            setTransportCost(0);
            setCustomDeposit(null);
            setEstimatedDays(1);
            fetchActiveRentals();

            alert("¡Salida registrada exitosamente!");
        } catch (error) {
            console.error("Error al generar salida:", error);
            alert(`Error: ${error.message || "No se pudo completar la operación"}`);
        } finally {
            setLoading(false);
        }
    };

    const generateEstimatePDF = (id) => {
        const doc = new jsPDF();
        const primaryColor = [251, 191, 36]; // #fbbf24

        // Header
        doc.setFillColor(30, 41, 59);
        doc.rect(0, 0, 210, 40, 'F');

        doc.setTextColor(255, 255, 255);
        doc.setFontSize(24);
        doc.setFont('helvetica', 'bold');
        doc.text('FERRO', 20, 20);

        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        doc.text('ANDAMIOS Y TABLONES VALLEDUPAR', 20, 27);
        doc.text('Calle 31 No. 4A-62 | Cel: 301 549 3000', 20, 32);

        doc.setTextColor(255, 255, 255);
        doc.text('ESTIMADO DE SALIDA', 140, 20, { align: 'right' });
        doc.text(`Fecha: ${format(new Date(), 'dd/MM/yyyy')}`, 140, 27, { align: 'right' });

        // Client Info Box
        doc.setTextColor(0, 0, 0);
        doc.setFontSize(12);
        doc.text('DATOS DEL CLIENTE', 20, 50);
        doc.setDrawColor(200);
        doc.line(20, 52, 190, 52);

        doc.setFontSize(10);
        doc.text(`Cliente: ${clientInfo.name}`, 20, 60);
        doc.text(`NIT/CC: ${clientInfo.nit}`, 20, 65);
        doc.text(`Ubicación: ${clientInfo.address}`, 20, 70);
        doc.text(`Obra Destino: ${clientInfo.workSite}`, 120, 60);
        doc.text(`Teléfono: ${clientInfo.phone}`, 120, 65);
        doc.text(`Días Estimados: ${estimatedDays}`, 120, 70);

        autoTable(doc, {
            startY: 80,
            head: [['Descripción', 'Cant.', 'Vr. Día', 'Total Est.']],
            body: selectedItems.map(i => [
                i.name,
                i.quantity,
                `$${i.editablePrice.toLocaleString()}`,
                `$${(i.editablePrice * i.quantity * estimatedDays).toLocaleString()}`
            ]),
            headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255] },
            alternateRowStyles: { fillColor: [245, 245, 245] },
        });

        const finalY = doc.lastAutoTable ? doc.lastAutoTable.finalY + 10 : 150;

        // Summary Box
        doc.setFillColor(30, 41, 59);
        doc.rect(130, finalY, 60, 35, 'F');
        doc.setTextColor(255, 255, 255);
        doc.text(`Subtotal: $${totals.subtotalTotal.toLocaleString()}`, 135, finalY + 10);
        doc.text(`Transporte: $${transportCost.toLocaleString()}`, 135, finalY + 17);
        doc.setFontSize(11);
        doc.text(`DEPÓSITO: $${totals.deposit.toLocaleString()}`, 135, finalY + 28);

        // Conditions
        doc.setTextColor(100);
        doc.setFontSize(8);
        doc.text('CONDICIONES:', 20, finalY + 50);
        doc.text('1. El arrendatario declara haber recibido los equipos en buen estado.', 20, finalY + 55);
        doc.text('2. El tiempo mínimo de alquiler para andamios es de 3 días.', 20, finalY + 59);
        doc.text('3. Parales y cerchas se cobran mínimo por 6 días.', 20, finalY + 63);

        doc.save(`ESTIMADO_FERRO_${clientInfo.nit}.pdf`);
    };

    const handleReturn = async () => {
        const rental = liquidatingRental;
        if (!rental) return;

        setLoading(true);
        try {
            const returnDate = new Date();
            const days = overrideDays !== null ? overrideDays : Math.max(1, differenceInDays(returnDate, new Date(rental.start_date)));

            let subtotal = 0;
            const itemsToReturn = [];
            const itemsToKeep = [];

            rental.rental_items.forEach(ri => {
                const qtyToReturn = returnQtys[ri.id] || 0;
                if (qtyToReturn > 0) {
                    const rowTotal = (ri.unit_price_at_time || 0) * qtyToReturn * days;
                    subtotal += rowTotal;
                    itemsToReturn.push({
                        id: ri.id,
                        name: ri.inventory?.name || 'Equipo',
                        qty: qtyToReturn,
                        price: ri.unit_price_at_time,
                        days: days,
                        total: rowTotal,
                        originalQty: ri.quantity
                    });
                }

                const remainingQty = ri.quantity - qtyToReturn;
                if (remainingQty > 0) {
                    itemsToKeep.push({ id: ri.id, remainingQty });
                }
            });

            if (itemsToReturn.length === 0) {
                alert("Debes devolver al menos un artículo.");
                setLoading(false);
                return;
            }

            const finalAmount = (subtotal + parseFloat(finalAdjustment || 0));
            const balancePostDeposit = finalAmount - (rental.total_deposit || 0);
            const finalBalance = balancePostDeposit - parseFloat(receivedAmount || 0);

            // 1. Actualizar items y estado del alquiler
            // Decrementar cantidades de los items devueltos
            for (const item of itemsToReturn) {
                const newQty = item.originalQty - item.qty;
                if (newQty <= 0) {
                    await supabase.from('rental_items').delete().eq('id', item.id);
                } else {
                    await supabase.from('rental_items').update({ quantity: newQty }).eq('id', item.id);
                }
            }

            // Si no quedan items, marcar como devuelto. Si no, aplicar el depósito y seguir.
            const isFullyReturned = itemsToKeep.length === 0;

            if (isFullyReturned) {
                await supabase.from('rentals').update({
                    status: 'RETURNED',
                    end_date_actual: returnDate.toISOString()
                }).eq('id', rental.id);
            } else {
                // Si es parcial, el depósito se "consume" en esta factura o se mantiene?
                // Según el usuario: "que de paso quede el saldo pendiente para la nueva liquidacion"
                // El depósito ya se aplicó en el cálculo de finalBalance.
                // Para simplificar, si es parcial, reseteamos el depósito del alquiler a 0 
                // ya que ya se aplicó a esta factura parcial.
                await supabase.from('rentals').update({ total_deposit: 0 }).eq('id', rental.id);
            }

            // 2. Crear registro de factura
            const { error: invoiceError } = await supabase
                .from('invoices')
                .insert([{
                    rental_id: rental.id,
                    total_amount: finalAmount,
                    final_balance: finalBalance,
                    adjustment: parseFloat(finalAdjustment || 0),
                    received_amount: parseFloat(receivedAmount || 0),
                    transport_cost: 0
                }]);

            if (invoiceError) throw invoiceError;

            // 3. Generar PDF y Refrescar
            generateInvoicePDF(rental, itemsToReturn, finalAmount, finalBalance, days);

            await fetchActiveRentals();
            confetti();
            setLiquidatingRental(null);
            setOverrideDays(null);
            setFinalAdjustment(0);
            setReceivedAmount(0);
            setReturnQtys({});

            alert(isFullyReturned ? "Liquidación total completada." : "Liquidación parcial completada. El alquiler sigue activo con los items restantes.");
        } catch (error) {
            console.error("Error al liquidar:", error);
            alert(`Error al liquidar: ${error.message || "Error desconocido"}`);
        } finally {
            setLoading(false);
        }
    };

    const generateInvoicePDF = (rental, items, total, balance, actualDays) => {
        const appliedTransport = 0; // Removido por solicitud del usuario
        const doc = new jsPDF();

        // Helper para asegurar números válidos
        const num = (val) => {
            const n = parseFloat(val);
            return isNaN(n) ? 0 : n;
        };

        // Header
        doc.setFillColor(251, 191, 36);
        doc.rect(0, 0, 210, 40, 'F');

        doc.setTextColor(15, 23, 42);
        doc.setFontSize(24);
        doc.text('FERRO', 20, 20);
        doc.setFontSize(10);
        doc.text('FACTURA DE VENTA - RÉGIMEN SIMPLIFICADO', 20, 28);

        doc.text(`No. 000${Math.floor(Math.random() * 1000)}`, 190, 20, { align: 'right' });
        doc.text(`Fecha: ${format(new Date(), 'dd/MM/yyyy')}`, 190, 27, { align: 'right' });

        // Client & Dates
        doc.setTextColor(0);
        doc.setFontSize(12);
        doc.text('RECEPTOR', 20, 50);
        doc.setDrawColor(200);
        doc.line(20, 52, 190, 52);

        doc.setFontSize(10);
        doc.text(`Cliente: ${rental.clients?.name || 'N/A'}`, 20, 60);
        doc.text(`NIT/CC: ${rental.clients?.nit_cc || 'N/A'}`, 20, 65);
        doc.text(`Obra: ${rental.work_site || 'N/A'}`, 20, 70);

        doc.text(`Fecha Inicio: ${format(new Date(rental.start_date), 'dd/MM/yyyy')}`, 120, 60);
        doc.text(`Fecha Fin: ${format(new Date(), 'dd/MM/yyyy')}`, 120, 65);
        doc.text(`Días Totales: ${String(num(actualDays))}`, 120, 70);

        autoTable(doc, {
            startY: 80,
            head: [['Equipo', 'Cant.', 'Vr. Día', 'Días Fact.', 'Total']],
            body: items.map(i => [
                String(i.name || 'N/A'),
                String(i.qty || 0),
                `$${num(i.price).toLocaleString()}`,
                String(num(i.days)),
                `$${num(i.total).toLocaleString()}`
            ]),
            headStyles: { fillColor: [15, 23, 42] },
        });

        const lastAutoTable = doc.lastAutoTable;
        const lastY = (lastAutoTable && typeof lastAutoTable.finalY === 'number') ? lastAutoTable.finalY : 150;
        const finalY = isFinite(lastY) ? lastY + 10 : 150;

        // Totals
        const summaryX = 130;
        doc.setFontSize(10);
        doc.text(`Subtotal Equipos:`, summaryX, finalY);
        const subtotalEquipos = num(total) - (num(appliedTransport) + num(finalAdjustment));
        doc.text(`$${subtotalEquipos.toLocaleString()}`, 190, finalY, { align: 'right' });

        doc.text(`Transporte:`, summaryX, finalY + 6);
        doc.text(`$${num(appliedTransport).toLocaleString()}`, 190, finalY + 6, { align: 'right' });

        if (num(finalAdjustment) !== 0) {
            doc.text(num(finalAdjustment) > 0 ? `Ajuste Adicional:` : `Descuento:`, summaryX, finalY + 12);
            doc.text(`$${num(finalAdjustment).toLocaleString()}`, 190, finalY + 12, { align: 'right' });
        }

        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.text(`TOTAL FACTURA:`, summaryX, finalY + 20);
        doc.text(`$${num(total).toLocaleString()}`, 190, finalY + 20, { align: 'right' });

        doc.setFont('helvetica', 'normal');
        doc.text(`Depósito Aplicado:`, summaryX, finalY + 26);
        doc.text(`-$${num(rental.total_deposit).toLocaleString()}`, 190, finalY + 26, { align: 'right' });

        if (num(balance) > 0) {
            doc.setFillColor(239, 68, 68); // Red
        } else {
            doc.setFillColor(16, 185, 129); // Green
        }

        doc.rect(130, finalY + 31, 65, 12, 'F');
        doc.setTextColor(255, 255, 255);
        doc.text(num(balance) > 0 ? `SALDO PENDIENTE:` : `SALDO A FAVOR:`, 135, finalY + 39);
        doc.text(`$${Math.abs(num(balance)).toLocaleString()}`, 190, finalY + 39, { align: 'right' });

        // Legal and conditions
        doc.setTextColor(50);
        doc.setFontSize(8);
        const condY = finalY + 55;
        doc.setFont('helvetica', 'bold');
        doc.text('CONDICIONES Y OBLIGACIONES:', 20, condY);
        doc.setFont('helvetica', 'normal');
        const conditions = [
            "1. El arrendatario se obliga a pagar el valor del alquiler por el tiempo que tenga el equipo en su poder.",
            "2. En caso de pérdida o daño del equipo, el arrendatario pagará el valor comercial de reposición.",
            "3. La mora en el pago de los cánones de arrendamiento causará intereses a la tasa máxima permitida.",
            "4. Esta factura se asimila en sus efectos a la letra de cambio según art. 774 del Código de Comercio.",
            "5. El equipo debe ser entregado en las mismas condiciones que fue recibido, limpio y funcional."
        ];
        conditions.forEach((text, i) => doc.text(text, 20, condY + 5 + (i * 4)));

        // Signatures
        doc.line(20, condY + 40, 80, condY + 40);
        doc.text('RECIBÍ CONFORME (CLIENTE)', 20, condY + 45);

        doc.line(120, condY + 40, 180, condY + 40);
        doc.text('ENTREGADO POR (FERRO)', 120, condY + 45);

        doc.save(`FACTURA_FERRO_${rental.clients.nit_cc}.pdf`);
    };

    const downloadAccountingReport = () => {
        const doc = new jsPDF();

        // Header Estilizado
        doc.setFillColor(30, 41, 59);
        doc.rect(0, 0, 210, 40, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(22);
        doc.setFont('helvetica', 'bold');
        doc.text('REPORTE CONTABLE FERRO', 105, 20, { align: 'center' });

        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        const periodText = accountingFilter === 'all' ? 'Histórico Completo' : `Filtro: ${accountingFilter}`;
        doc.text(`Periodo: ${periodText}`, 105, 28, { align: 'center' });
        doc.text(`Generado: ${format(new Date(), 'dd/MM/yyyy HH:mm')}`, 105, 33, { align: 'center' });

        const tableBody = accountingData.map(inv => [
            format(new Date(inv.created_at), 'dd/MM/yyyy'),
            inv.rentals?.clients?.name || 'N/A',
            `$${inv.total_amount.toLocaleString()}`,
            `$${inv.rentals?.total_deposit?.toLocaleString() || 0}`,
            `$${inv.final_balance.toLocaleString()}`
        ]);

        autoTable(doc, {
            startY: 50,
            head: [['Fecha', 'Cliente', 'Vr. Total', 'Depósito', 'Saldo Pend.']],
            body: tableBody,
            theme: 'striped',
            headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontStyle: 'bold' },
            styles: { fontSize: 9, cellPadding: 3 },
            columnStyles: {
                2: { halign: 'right' },
                3: { halign: 'right' },
                4: { halign: 'right' }
            }
        });

        const finalYAtEnd = doc.lastAutoTable ? doc.lastAutoTable.finalY + 15 : 100;
        const totalSum = accountingData.reduce((acc, inv) => acc + inv.total_amount, 0);
        const totalPending = accountingData.reduce((acc, inv) => inv.final_balance > 0 ? acc + inv.final_balance : acc, 0);

        doc.setFillColor(245, 245, 245);
        doc.rect(120, finalYAtEnd - 5, 75, 25, 'F');
        doc.setTextColor(30, 41, 59);
        doc.setFont('helvetica', 'bold');
        doc.text(`TOTAL FACTURADO:`, 125, finalYAtEnd + 5);
        doc.text(`$${totalSum.toLocaleString()}`, 190, finalYAtEnd + 5, { align: 'right' });

        doc.setTextColor(239, 68, 68);
        doc.text(`POR RECAUDAR:`, 125, finalYAtEnd + 13);
        doc.text(`$${totalPending.toLocaleString()}`, 190, finalYAtEnd + 13, { align: 'right' });

        doc.save(`REPORTE_FERRO_${format(new Date(), 'yyyyMMdd')}.pdf`);
    };

    if (!session) {
        return (
            <div className="flex" style={{ height: '100vh', justifyContent: 'center', alignItems: 'center', background: 'var(--bg-dark)' }}>
                <form onSubmit={handleLogin} className="glass-card animate-in" style={{ width: '400px' }}>
                    <div className="flex" style={{ justifyContent: 'center', marginBottom: '2rem' }}>
                        <Package size={48} color="var(--primary)" />
                        <h1 style={{ fontSize: '2rem' }}>FERRO</h1>
                    </div>
                    <p style={{ textAlign: 'center', color: 'var(--text-muted)', marginBottom: '1.5rem' }}>Sistema de Gestión de Alquiler</p>
                    <div className="grid">
                        <input type="email" placeholder="Correo Electrónico" value={email} onChange={e => setEmail(e.target.value)} required />
                        <input type="password" placeholder="Contraseña" value={password} onChange={e => setPassword(e.target.value)} required />
                        <button type="submit" className="primary" style={{ marginTop: '1rem' }}>Entrar al Sistema</button>
                        <button
                            type="button"
                            className="ghost"
                            style={{ marginTop: '0.5rem', fontSize: '0.8rem' }}
                            onClick={async () => {
                                const { error } = await supabase.auth.signUp({ email, password });
                                if (error) alert(error.message);
                                else alert("Usuario creado. Intenta entrar ahora.");
                            }}
                        >
                            Registrar Administrador
                        </button>
                    </div>
                    <p style={{ marginTop: '1.5rem', fontSize: '0.8rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                        Nota: Use sus credenciales de Supabase Auth
                    </p>
                </form>
            </div>
        );
    }

    return (
        <div className="container animate-in">
            <header className="flex" style={{ justifyContent: 'space-between', marginBottom: '3rem' }}>
                <div className="flex">
                    <div style={{ backgroundColor: 'var(--primary)', padding: '0.75rem', borderRadius: '1rem' }}>
                        <Package size={32} color="var(--bg-dark)" />
                    </div>
                    <div>
                        <h1 style={{ fontSize: '1.5rem', fontWeight: 800 }}>FERRO</h1>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Valledupar, Colombia</p>
                    </div>
                </div>
                <nav className="flex glass-card" style={{ padding: '0.5rem' }}>
                    <button className={activeTab === 'new-rental' ? 'primary' : 'ghost'} onClick={() => setActiveTab('new-rental')}>Nueva Salida</button>
                    <button className={activeTab === 'rentals' ? 'primary' : 'ghost'} onClick={() => setActiveTab('rentals')}>Alquileres Activos</button>
                    <button className={activeTab === 'clients' ? 'primary' : 'ghost'} onClick={() => setActiveTab('clients')}>Clientes</button>
                    <button className={activeTab === 'accounting' ? 'primary' : 'ghost'} onClick={() => setActiveTab('accounting')}>Contabilidad</button>
                    <button className={activeTab === 'inventory' ? 'primary' : 'ghost'} onClick={() => setActiveTab('inventory')}>Inventario</button>
                    <button className="ghost" onClick={() => supabase.auth.signOut()} style={{ color: 'var(--error)' }}><LogOut size={18} /></button>
                </nav>
            </header>

            {activeTab === 'new-rental' && (
                <div className="grid" style={{ gridTemplateColumns: '1fr 380px' }}>
                    <div className="grid">
                        <section className="glass-card">
                            <h2 className="flex" style={{ marginBottom: '1.5rem' }}><Users size={20} color="var(--primary)" /> Datos del Cliente</h2>
                            <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                <input placeholder="Nombre / Empresa" value={clientInfo.name} onChange={e => setClientInfo({ ...clientInfo, name: e.target.value })} />
                                <input placeholder="NIT / Cédula" value={clientInfo.nit} onChange={e => setClientInfo({ ...clientInfo, nit: e.target.value })} />
                                <input placeholder="Teléfono" value={clientInfo.phone} onChange={e => setClientInfo({ ...clientInfo, phone: e.target.value })} />
                                <input placeholder="Ubicación de Obra" value={clientInfo.workSite} onChange={e => setClientInfo({ ...clientInfo, workSite: e.target.value })} />
                            </div>
                        </section>

                        <section className="glass-card">
                            <h2 className="flex" style={{ marginBottom: '1.5rem' }}><Package size={20} color="var(--primary)" /> Equipos Disponibles</h2>
                            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', maxHeight: '420px', overflowY: 'auto' }}>
                                {inventory.map(item => (
                                    <div key={item.id} className="glass-card" style={{ padding: '1rem', cursor: 'pointer', border: '1px solid var(--glass-border)' }} onClick={() => addItem(item)}>
                                        <p style={{ fontWeight: 600 }}>{item.name}</p>
                                        <p style={{ color: 'var(--primary)', fontSize: '0.9rem' }}>${item.unit_price.toLocaleString()} / día</p>
                                        {item.min_days > 0 && <span style={{ fontSize: '0.7rem', background: 'var(--glass)', padding: '2px 6px', borderRadius: '4px' }}>Mín. {item.min_days} días</span>}
                                    </div>
                                ))}
                            </div>
                        </section>
                    </div>

                    <aside>
                        <div className="glass-card" style={{ position: 'sticky', top: '1rem' }}>
                            <h2 className="flex" style={{ marginBottom: '1.5rem' }}><Calculator size={20} color="var(--primary)" /> Resumen Salida</h2>
                            <div style={{ maxHeight: '300px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1.5rem' }}>
                                {selectedItems.map(item => (
                                    <div key={item.id} className="flex" style={{ justifyContent: 'space-between', background: 'var(--glass)', padding: '0.6rem', borderRadius: '8px' }}>
                                        <div style={{ flex: 1 }}>
                                            <p style={{ fontSize: '0.85rem' }}>{item.name}</p>
                                            <div className="flex" style={{ marginTop: '0.2rem' }}>
                                                <button onClick={() => updateQuantity(item.id, item.quantity - 1)} className="ghost" style={{ padding: '0 5px' }}>-</button>
                                                <span style={{ fontSize: '0.9rem' }}>{item.quantity}</span>
                                                <button onClick={() => updateQuantity(item.id, item.quantity + 1)} className="ghost" style={{ padding: '0 5px' }}>+</button>
                                            </div>
                                        </div>
                                        <button onClick={() => removeItem(item.id)} style={{ color: 'var(--error)' }} className="ghost"><Trash2 size={14} /></button>
                                    </div>
                                ))}
                            </div>

                            <div className="grid" style={{ gap: '0.75rem', borderTop: '1px solid var(--glass-border)', paddingTop: '1rem' }}>
                                <div className="flex" style={{ justifyContent: 'space-between' }}>
                                    <span style={{ fontSize: '0.9rem' }}>Días a Alquilar</span>
                                    <input type="number" style={{ width: '80px', padding: '0.3rem' }} value={estimatedDays} onChange={e => setEstimatedDays(parseInt(e.target.value) || 1)} min="1" />
                                </div>
                                <div className="flex" style={{ justifyContent: 'space-between' }}>
                                    <span style={{ fontSize: '0.9rem' }}>Transporte</span>
                                    <input
                                        type="number"
                                        style={{ width: '120px', padding: '0.3rem' }}
                                        value={transportCost === 0 ? '' : transportCost}
                                        onChange={e => setTransportCost(e.target.value === '' ? 0 : parseFloat(e.target.value))}
                                        onFocus={e => e.target.select()}
                                    />
                                </div>
                                <div className="flex" style={{ justifyContent: 'space-between' }}>
                                    <span style={{ fontSize: '0.9rem' }}>Depósito</span>
                                    <div className="flex" style={{ gap: '0.5rem' }}>
                                        {customDeposit !== null && (
                                            <button
                                                className="ghost"
                                                style={{ fontSize: '0.7rem', color: 'var(--primary)', padding: '2px' }}
                                                onClick={() => setCustomDeposit(null)}
                                            >
                                                Ver Sugerido
                                            </button>
                                        )}
                                        <input
                                            type="number"
                                            style={{ width: '120px', padding: '0.3rem', color: customDeposit !== null ? 'var(--primary)' : 'white' }}
                                            value={totals.deposit === 0 ? '' : totals.deposit}
                                            onChange={e => setCustomDeposit(e.target.value === '' ? 0 : parseFloat(e.target.value))}
                                            onFocus={e => e.target.select()}
                                        />
                                    </div>
                                </div>
                                <div className="flex" style={{ justifyContent: 'space-between', fontSize: '1.3rem', fontWeight: 900, marginTop: '0.5rem' }}>
                                    <span>Venta Est. ({estimatedDays}d)</span>
                                    <span style={{ color: 'var(--primary)' }}>${totals.total.toLocaleString()}</span>
                                </div>
                                <button className="primary" style={{ width: '100%', marginTop: '1rem' }} onClick={handleGenerateEstimate} disabled={loading || selectedItems.length === 0}>
                                    {loading ? 'Generando...' : 'GENERAR SALIDA / DEPÓSITO'}
                                </button>
                            </div>
                        </div>
                    </aside>
                </div>
            )}

            {activeTab === 'rentals' && (
                <div className="glass-card animate-in">
                    <h2 className="flex" style={{ marginBottom: '2rem' }}><Calendar size={22} color="var(--primary)" /> Equipos en Obra</h2>
                    <div className="grid">
                        {activeRentals.map(rental => (
                            <div key={rental.id} className="glass-card flex" style={{ justifyContent: 'space-between', border: '1px solid var(--glass-border)' }}>
                                <div>
                                    <h3 style={{ fontSize: '1.1rem' }}>{rental.clients.name}</h3>
                                    <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Inició: {format(new Date(rental.start_date), 'dd/MM/yyyy')}</p>
                                    <p style={{ fontSize: '0.9rem', marginTop: '0.5rem' }}>
                                        {rental.rental_items.map(ri => `${ri.quantity}x ${ri.inventory.name}`).join(', ')}
                                    </p>
                                </div>
                                <div style={{ textAlign: 'right' }}>
                                    <p style={{ color: 'var(--accent)', fontSize: '0.85rem' }}>Depósito: ${rental.total_deposit.toLocaleString()}</p>
                                    <button
                                        className="primary"
                                        style={{ marginTop: '0.8rem', background: 'var(--success)', color: 'white' }}
                                        onClick={() => {
                                            const initialQtys = {};
                                            rental.rental_items.forEach(ri => {
                                                initialQtys[ri.id] = ri.quantity;
                                            });
                                            setReturnQtys(initialQtys);
                                            setLiquidatingRental(rental);
                                            setOverrideDays(Math.max(1, differenceInDays(new Date(), new Date(rental.start_date))));
                                        }}
                                    >
                                        Liquidar
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Modal de Liquidación */}
                    {liquidatingRental && (
                        <div style={{
                            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                            background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
                        }}>
                            <div className="glass-card animate-in" style={{ width: '600px', border: '1px solid var(--primary)', maxHeight: '90vh', overflowY: 'auto' }}>
                                <div className="flex" style={{ justifyContent: 'space-between', marginBottom: '1.5rem' }}>
                                    <h2 className="flex"><Calculator size={22} color="var(--primary)" /> Liquidar Alquiler</h2>
                                    <span style={{ fontSize: '0.8rem', color: 'var(--text-white)' }}>Cliente: <strong>{liquidatingRental.clients?.name}</strong></span>
                                </div>

                                <div className="grid" style={{ gap: '1rem' }}>
                                    {/* Selección de Cantidades a Devolver */}
                                    <div style={{ background: 'var(--glass)', padding: '1rem', borderRadius: '0.5rem' }}>
                                        <h3 style={{ fontSize: '0.9rem', marginBottom: '0.8rem', color: 'var(--primary)' }}>Equipos a Devolver (Cantidad)</h3>
                                        <div className="grid" style={{ gap: '0.8rem' }}>
                                            {liquidatingRental.rental_items.map(ri => (
                                                <div key={ri.id} className="flex" style={{ justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--glass-border)', paddingBottom: '0.5rem' }}>
                                                    <div>
                                                        <p style={{ fontSize: '0.9rem', fontWeight: 600 }}>{ri.inventory?.name}</p>
                                                        <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>En obra: {ri.quantity}</p>
                                                    </div>
                                                    <div className="flex" style={{ gap: '0.5rem' }}>
                                                        <input
                                                            type="number"
                                                            min="0"
                                                            max={ri.quantity}
                                                            value={returnQtys[ri.id] || 0}
                                                            onChange={e => {
                                                                const val = Math.min(ri.quantity, Math.max(0, parseInt(e.target.value) || 0));
                                                                setReturnQtys({ ...returnQtys, [ri.id]: val });
                                                            }}
                                                            onFocus={e => e.target.select()}
                                                            style={{ width: '60px', textAlign: 'center', padding: '0.2rem' }}
                                                        />
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                        <div>
                                            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Días a Facturar</label>
                                            <input
                                                type="number"
                                                value={overrideDays === 0 ? '' : overrideDays}
                                                onChange={e => setOverrideDays(e.target.value === '' ? 0 : parseInt(e.target.value))}
                                                onFocus={e => e.target.select()}
                                                style={{ width: '100%', marginTop: '0.4rem' }}
                                            />
                                        </div>
                                        <div>
                                            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Ajuste / Descuento</label>
                                            <input
                                                type="number"
                                                value={finalAdjustment === 0 ? '' : finalAdjustment}
                                                onChange={e => setFinalAdjustment(e.target.value === '' ? 0 : parseFloat(e.target.value))}
                                                onFocus={e => e.target.select()}
                                                placeholder="+ o - valor"
                                                style={{ width: '100%', marginTop: '0.4rem', color: finalAdjustment < 0 ? 'var(--success)' : (finalAdjustment > 0 ? 'var(--error)' : 'white') }}
                                            />
                                        </div>
                                    </div>

                                    <div style={{ background: 'var(--glass)', padding: '1rem', borderRadius: '0.5rem', marginTop: '0.5rem' }}>
                                        <div className="flex" style={{ justifyContent: 'space-between', fontSize: '0.9rem' }}>
                                            <span>Subtotal equipos retornados:</span>
                                            <span>${(liquidatingRental.rental_items.reduce((acc, ri) => {
                                                const qty = returnQtys[ri.id] || 0;
                                                return acc + (ri.unit_price_at_time * qty);
                                            }, 0) * (overrideDays || Math.max(1, differenceInDays(new Date(), new Date(liquidatingRental.start_date))))).toLocaleString()}</span>
                                        </div>
                                        <div className="flex" style={{ justifyContent: 'space-between', fontSize: '1.1rem', fontWeight: 700, marginTop: '0.5rem', borderTop: '1px solid var(--glass-border)', paddingTop: '0.5rem' }}>
                                            <span>TOTAL ESTA LIQUIDACIÓN:</span>
                                            <span style={{ color: 'var(--primary)' }}>
                                                ${((liquidatingRental.rental_items.reduce((acc, ri) => {
                                                    const qty = returnQtys[ri.id] || 0;
                                                    return acc + (ri.unit_price_at_time * qty);
                                                }, 0) * (overrideDays || Math.max(1, differenceInDays(new Date(), new Date(liquidatingRental.start_date)))))
                                                    + parseFloat(finalAdjustment || 0)).toLocaleString()}</span >
                                        </div>

                                        {(() => {
                                            const subtotalDias = liquidatingRental.rental_items.reduce((acc, ri) => {
                                                const qty = returnQtys[ri.id] || 0;
                                                return acc + (ri.unit_price_at_time * qty);
                                            }, 0) * (overrideDays || Math.max(1, differenceInDays(new Date(), new Date(liquidatingRental.start_date))));

                                            const finalTotal = subtotalDias + parseFloat(finalAdjustment || 0);
                                            const balancePostDeposit = finalTotal - liquidatingRental.total_deposit;
                                            const finalPending = balancePostDeposit - parseFloat(receivedAmount || 0);

                                            return (
                                                <>
                                                    <div className="flex" style={{
                                                        justifyContent: 'space-between',
                                                        fontSize: '1.2rem',
                                                        fontWeight: 800,
                                                        marginTop: '1rem',
                                                        padding: '0.8rem',
                                                        background: balancePostDeposit > 0 ? 'rgba(239, 68, 68, 0.1)' : 'rgba(16, 185, 129, 0.1)',
                                                        borderRadius: '8px',
                                                        color: balancePostDeposit > 0 ? 'var(--error)' : 'var(--success)',
                                                        border: `1px solid ${balancePostDeposit > 0 ? 'var(--error)' : 'var(--success)'}`
                                                    }}>
                                                        <span>{balancePostDeposit > 0 ? 'SALDO A COBRAR:' : 'A DEVOLVER:'}</span>
                                                        <span>${Math.abs(balancePostDeposit).toLocaleString()}</span>
                                                    </div>

                                                    {balancePostDeposit > 0 && (
                                                        <div style={{ marginTop: '1.5rem', borderTop: '1px solid var(--glass-border)', paddingTop: '1rem' }}>
                                                            <label style={{ fontSize: '0.8rem', color: 'var(--primary)', fontWeight: 600 }}>Monto Recibido hoy (Transferencia/Efectivo):</label>
                                                            <input
                                                                type="number"
                                                                value={receivedAmount === 0 ? '' : receivedAmount}
                                                                onChange={e => setReceivedAmount(e.target.value === '' ? 0 : parseFloat(e.target.value))}
                                                                onFocus={e => e.target.select()}
                                                                placeholder="¿Cuánto pagó el cliente?"
                                                                style={{ width: '100%', marginTop: '0.5rem', fontSize: '1.2rem', fontWeight: 700, border: '1px solid var(--primary)' }}
                                                            />
                                                            <div className="flex" style={{ justifyContent: 'space-between', marginTop: '0.8rem', fontSize: '0.9rem' }}>
                                                                <span style={{ color: 'var(--text-muted)' }}>Saldo Pendiente Final:</span>
                                                                <span style={{ fontWeight: 700, color: finalPending > 0 ? 'var(--error)' : 'var(--success)' }}>
                                                                    ${finalPending.toLocaleString()}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    )}
                                                </>
                                            );
                                        })()}
                                    </div>

                                    <div style={{ marginTop: '1rem' }} className="flex">
                                        <button className="ghost" style={{ flex: 1 }} onClick={() => { setLiquidatingRental(null); setFinalAdjustment(0); setReceivedAmount(0); setReturnQtys({}); }}>Cancelar</button>
                                        <button className="primary" style={{ flex: 1, background: 'var(--success)' }} onClick={handleReturn} disabled={loading}>
                                            {loading ? 'Procesando...' : 'Generar Factura'}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {activeRentals.length === 0 && <p style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>No hay alquileres activos en este momento.</p>}
                </div>
            )}

            {activeTab === 'clients' && (
                <div className="glass-card animate-in">
                    <div className="flex" style={{ justifyContent: 'space-between', marginBottom: '2rem' }}>
                        <h2 className="flex"><Users size={22} color="var(--primary)" /> Gestión de Clientes</h2>
                        <div className="flex" style={{ gap: '0.5rem' }}>
                            <button className="ghost flex" onClick={() => setClientViewMode(clientViewMode === 'cards' ? 'list' : 'cards')} style={{ fontSize: '0.8rem' }}>
                                {clientViewMode === 'cards' ? 'Vista Lista' : 'Vista Tarjetas'}
                            </button>
                        </div>
                    </div>

                    {clientViewMode === 'cards' ? (
                        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1.5rem' }}>
                            {clientsData.map(client => (
                                <div key={client.id} className="glass-card" style={{ border: '1px solid var(--glass-border)', transition: 'transform 0.2s', cursor: 'default' }}>
                                    <div className="flex" style={{ justifyContent: 'space-between', marginBottom: '1rem' }}>
                                        <h3 style={{ fontSize: '1.1rem', fontWeight: 700 }}>{client.name}</h3>
                                        {client.activeProjects > 0 ?
                                            <span style={{ fontSize: '0.7rem', background: 'var(--success)', padding: '2px 8px', borderRadius: '1rem' }}>ACTIVO</span> :
                                            <span style={{ fontSize: '0.7rem', background: 'var(--glass)', padding: '2px 8px', borderRadius: '1rem' }}>INACTIVO</span>
                                        }
                                    </div>
                                    <div className="grid" style={{ gap: '0.5rem', fontSize: '0.9rem' }}>
                                        <p style={{ color: 'var(--text-muted)' }}>NIT: {client.nit_cc}</p>
                                        <p style={{ color: 'var(--text-muted)' }}>Tel: {client.phone}</p>
                                        <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--glass-border)' }}>
                                            <div className="flex" style={{ justifyContent: 'space-between', marginBottom: '0.3rem' }}>
                                                <span>Total Compras:</span>
                                                <span style={{ color: 'var(--primary)', fontWeight: 800 }}>${client.totalGenerated.toLocaleString()}</span>
                                            </div>
                                            <div className="flex" style={{ justifyContent: 'space-between' }}>
                                                <span>Obras Activas:</span>
                                                <span>{client.activeProjects}</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
                                <thead>
                                    <tr style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                                        <th style={{ padding: '1rem' }}>Cliente</th>
                                        <th style={{ padding: '1rem' }}>NIT/CC</th>
                                        <th style={{ padding: '1rem' }}>Teléfono</th>
                                        <th style={{ padding: '1rem' }}>Ventas Totales</th>
                                        <th style={{ padding: '1rem' }}>Estado</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {clientsData.map(client => (
                                        <tr key={client.id} style={{ borderTop: '1px solid var(--glass-border)' }}>
                                            <td style={{ padding: '1rem', fontWeight: 600 }}>{client.name}</td>
                                            <td style={{ padding: '1rem' }}>{client.nit_cc}</td>
                                            <td style={{ padding: '1rem' }}>{client.phone}</td>
                                            <td style={{ padding: '1rem', fontWeight: 700, color: 'var(--primary)' }}>${client.totalGenerated.toLocaleString()}</td>
                                            <td style={{ padding: '1rem' }}>
                                                {client.activeProjects > 0 ?
                                                    <span style={{ color: 'var(--success)' }}>Activo ({client.activeProjects})</span> :
                                                    <span style={{ color: 'var(--text-muted)' }}>Inactivo</span>
                                                }
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}

            {activeTab === 'accounting' && (
                <div className="glass-card animate-in">
                    <div className="flex" style={{ justifyContent: 'space-between', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
                        <div>
                            <h2 className="flex"><DollarSign size={22} color="var(--primary)" /> Contabilidad</h2>
                            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>El saldo pendiente es el valor que el cliente aún debe después de descontar su depósito inicial.</p>
                        </div>
                        <div className="flex" style={{ gap: '0.5rem' }}>
                            <select
                                value={accountingFilter}
                                onChange={e => setAccountingFilter(e.target.value)}
                                style={{
                                    padding: '0.5rem 1rem',
                                    borderRadius: '0.5rem',
                                    background: 'var(--bg-dark)',
                                    color: 'white',
                                    border: '1px solid var(--glass-border)',
                                    cursor: 'pointer',
                                    outline: 'none',
                                    appearance: 'none',
                                    minWidth: '150px'
                                }}
                            >
                                <option value="all" style={{ background: 'var(--bg-dark)' }}>Todo el tiempo</option>
                                <option value="today" style={{ background: 'var(--bg-dark)' }}>Hoy</option>
                                <option value="week" style={{ background: 'var(--bg-dark)' }}>Esta Semana</option>
                                <option value="month" style={{ background: 'var(--bg-dark)' }}>Este Mes</option>
                                <option value="custom" style={{ background: 'var(--bg-dark)' }}>Personalizado</option>
                            </select>
                            {accountingFilter === 'custom' && (
                                <div className="flex" style={{ gap: '0.3rem' }}>
                                    <input type="date" onChange={e => setCustomDates({ ...customDates, start: e.target.value })} style={{ padding: '0.3rem', fontSize: '0.8rem' }} />
                                    <input type="date" onChange={e => setCustomDates({ ...customDates, end: e.target.value })} style={{ padding: '0.3rem', fontSize: '0.8rem' }} />
                                </div>
                            )}
                            <button className="primary flex" onClick={downloadAccountingReport}><Download size={18} /> Informe PDF</button>
                        </div>
                    </div>

                    <div className="grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: '1.5rem', marginBottom: '2rem' }}>
                        <div className="glass-card" style={{ textAlign: 'center' }}>
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Total Facturado</p>
                            <h3 style={{ fontSize: '1.8rem', color: 'var(--primary)' }}>
                                ${accountingData.reduce((acc, inv) => acc + inv.total_amount, 0).toLocaleString()}
                            </h3>
                        </div>
                        <div className="glass-card" style={{ textAlign: 'center' }}>
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Saldos Pendientes</p>
                            <h3 style={{ fontSize: '1.8rem', color: 'var(--error)' }}>
                                ${accountingData.reduce((acc, inv) => inv.final_balance > 0 ? acc + inv.final_balance : acc, 0).toLocaleString()}
                            </h3>
                        </div>
                        <div className="glass-card" style={{ textAlign: 'center' }}>
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Facturas Generadas</p>
                            <h3 style={{ fontSize: '1.8rem' }}>{accountingData.length}</h3>
                        </div>
                    </div>

                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                                    <th style={{ padding: '1rem' }}>Fecha</th>
                                    <th style={{ padding: '1rem' }}>Cliente</th>
                                    <th style={{ padding: '1rem' }}>Valor Total</th>
                                    <th style={{ padding: '1rem' }}>Saldo (Post-Depósito)</th>
                                    <th style={{ padding: '1rem' }}>Estado</th>
                                    <th style={{ padding: '1rem' }}>Acción</th>
                                </tr>
                            </thead>
                            <tbody>
                                {accountingData.map(inv => (
                                    <tr key={inv.id} style={{ borderTop: '1px solid var(--glass-border)' }}>
                                        <td style={{ padding: '1rem' }}>{format(new Date(inv.created_at), 'dd/MM/yyyy')}</td>
                                        <td style={{ padding: '1rem' }}>
                                            <p style={{ fontWeight: 500 }}>{inv.rentals.clients.name}</p>
                                            <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>NIT: {inv.rentals.clients.nit_cc}</p>
                                        </td>
                                        <td style={{ padding: '1rem' }}>${inv.total_amount.toLocaleString()}</td>
                                        <td style={{ padding: '1rem', fontWeight: 700, color: inv.final_balance > 0 ? 'var(--error)' : 'var(--success)' }}>
                                            {inv.final_balance > 0 ? `+$${inv.final_balance.toLocaleString()}` : `-$${Math.abs(inv.final_balance).toLocaleString()}`}
                                        </td>
                                        <td style={{ padding: '1rem' }}>
                                            {inv.final_balance <= 0 ?
                                                <span style={{ color: 'var(--success)', fontSize: '0.8rem' }}>PAGADO</span> :
                                                <span style={{ color: 'var(--error)', fontSize: '0.8rem' }}>SALDO PDTE</span>
                                            }
                                        </td>
                                        <td style={{ padding: '1rem' }}>
                                            {inv.final_balance > 0 && (
                                                <button
                                                    className="ghost flex"
                                                    style={{ fontSize: '0.75rem', color: 'var(--primary)', padding: '4px 8px', border: '1px solid var(--primary)' }}
                                                    onClick={() => handleSettleInvoice(inv.id, inv.final_balance, inv.received_amount)}
                                                >
                                                    <DollarSign size={14} /> Registrar Pago
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {activeTab === 'inventory' && (
                <div className="glass-card animate-in">
                    <div className="flex" style={{ justifyContent: 'space-between', marginBottom: '2rem' }}>
                        <h2>Control de Inventario</h2>
                        <button className="primary flex" onClick={() => {
                            setEditingItem(null);
                            setInventoryForm({ name: '', ref: '', unit_price: 0, min_days: 0 });
                            setIsInventoryModalOpen(true);
                        }}><Plus size={18} /> Añadir Equipo</button>
                    </div>
                    <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                                <th style={{ padding: '1rem' }}>Ref</th>
                                <th style={{ padding: '1rem' }}>Producto</th>
                                <th style={{ padding: '1rem' }}>Precio/Día</th>
                                <th style={{ padding: '1rem' }}>Mín. Días</th>
                                <th style={{ padding: '1rem' }}>Acciones</th>
                            </tr>
                        </thead>
                        <tbody>
                            {inventory.map(item => (
                                <tr key={item.id} style={{ borderTop: '1px solid var(--glass-border)' }}>
                                    <td style={{ padding: '1rem' }}>{item.ref}</td>
                                    <td style={{ padding: '1rem', fontWeight: 500 }}>{item.name}</td>
                                    <td style={{ padding: '1rem' }}>${item.unit_price.toLocaleString()}</td>
                                    <td style={{ padding: '1rem' }}>{item.min_days || '-'}</td>
                                    <td style={{ padding: '1rem' }} className="flex">
                                        <button className="ghost" style={{ padding: '0.4rem', color: 'var(--primary)' }} onClick={() => {
                                            setEditingItem(item);
                                            setInventoryForm({ name: item.name, ref: item.ref, unit_price: item.unit_price, min_days: item.min_days });
                                            setIsInventoryModalOpen(true);
                                        }}><FileText size={16} /> Editar</button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>

                    {/* Modal Añadir/Editar Inventario */}
                    {isInventoryModalOpen && (
                        <div style={{
                            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                            background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
                        }}>
                            <div className="glass-card animate-in" style={{ width: '450px', border: '1px solid var(--primary)' }}>
                                <h2 style={{ marginBottom: '1.5rem' }}>{editingItem ? 'Editar Equipo' : 'Nuevo Equipo'}</h2>
                                <div className="grid" style={{ gap: '1rem' }}>
                                    <div>
                                        <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Referencia (Eje: AND-01)</label>
                                        <input
                                            type="text"
                                            value={inventoryForm.ref}
                                            onChange={e => setInventoryForm({ ...inventoryForm, ref: e.target.value })}
                                            placeholder="Referencia"
                                        />
                                    </div>
                                    <div>
                                        <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Nombre del Equipo</label>
                                        <input
                                            type="text"
                                            value={inventoryForm.name}
                                            onChange={e => setInventoryForm({ ...inventoryForm, name: e.target.value })}
                                            placeholder="Ej: Andamio Tubular"
                                        />
                                    </div>
                                    <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                        <div>
                                            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Precio por Día</label>
                                            <input
                                                type="number"
                                                value={inventoryForm.unit_price === 0 ? '' : inventoryForm.unit_price}
                                                onChange={e => setInventoryForm({ ...inventoryForm, unit_price: e.target.value === '' ? 0 : parseFloat(e.target.value) })}
                                                onFocus={e => e.target.select()}
                                            />
                                        </div>
                                        <div>
                                            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Días Mínimos</label>
                                            <input
                                                type="number"
                                                value={inventoryForm.min_days === 0 ? '' : inventoryForm.min_days}
                                                onChange={e => setInventoryForm({ ...inventoryForm, min_days: e.target.value === '' ? 0 : parseInt(e.target.value) })}
                                                onFocus={e => e.target.select()}
                                            />
                                        </div>
                                    </div>
                                    <div className="flex" style={{ marginTop: '1.5rem' }}>
                                        <button className="ghost" style={{ flex: 1 }} onClick={() => setIsInventoryModalOpen(false)}>Cancelar</button>
                                        <button className="primary" style={{ flex: 1 }} onClick={handleSaveInventory} disabled={loading}>
                                            {loading ? 'Guardando...' : 'Guardar Cambios'}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

export default App;
